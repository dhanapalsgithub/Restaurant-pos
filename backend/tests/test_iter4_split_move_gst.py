# Iteration 4: Split bills, split payments, table move/merge, monthly GST report + CSV exports
import csv
import io
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
GSTIN = "29ABCDE1234F1Z5"
MONTH = datetime.now(timezone.utc).strftime("%Y-%m")


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def s():
    u = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/stores/register", json={"store_name": "TEST_Iter4", "username": u,
                                                       "password": "pw12345", "gst_number": GSTIN})
    assert r.status_code == 200, r.text
    return _login(u, "pw12345")


def line(name="TEST Paneer", price=100.0, qty=2, rate=5.0):
    return {"item_id": f"x-{name}", "name": name, "qty": qty, "price": price, "tax_rate": rate}


def mk(s, items, discount=0.0, order_type="Takeaway", table_no=""):
    r = s.post(f"{API}/orders", json={"order_type": order_type, "items": items, "discount": discount, "table_no": table_no})
    assert r.status_code == 200, r.text
    return r.json()


def tbl(s, name):
    return next(t for t in s.get(f"{API}/tables").json() if t["name"] == name)


# ---------- Split creation ----------
class TestSplitCreate:
    def test_equal_split_sums_exactly(self, s):
        o = mk(s, [line(price=100.01, qty=1)])  # 105.01
        r = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 3})
        assert r.status_code == 200, r.text
        d = r.json()
        amts = [sp["amount"] for sp in d["splits"]]
        assert len(amts) == 3 and d["payment_mode"] == "Split"
        assert round(sum(amts), 2) == o["total"]
        assert amts[0] >= amts[1] >= amts[2] and round(amts[0] - amts[2], 2) <= 0.01

    def test_items_split_amounts(self, s):
        o = mk(s, [line("A", 100, 2, 5), line("B", 200, 1, 18)])
        groups = [[{"index": 0, "qty": 2}], [{"index": 1, "qty": 1}]]
        d = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "items", "groups": groups}).json()
        assert [sp["amount"] for sp in d["splits"]] == [210.0, 236.0]
        assert round(sum(sp["amount"] for sp in d["splits"]), 2) == o["total"]

    def test_items_split_with_discount(self, s):
        o = mk(s, [line("A", 100, 2, 5), line("B", 200, 1, 18)], discount=40)
        groups = [[{"index": 0, "qty": 1}], [{"index": 0, "qty": 1}, {"index": 1, "qty": 1}]]
        d = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "items", "groups": groups}).json()
        a = [sp["amount"] for sp in d["splits"]]
        assert a[0] == round(105 * 0.9, 2)
        assert round(sum(a), 2) == o["total"]

    @pytest.mark.parametrize("groups", [
        [[{"index": 0, "qty": 1}], [{"index": 1, "qty": 1}]],                       # unassigned unit
        [[{"index": 0, "qty": 2}], [{"index": 0, "qty": 1}, {"index": 1, "qty": 1}]],  # over-assigned
        [[{"index": 0, "qty": 2}, {"index": 1, "qty": 1}], []],                      # empty guest
        [[{"index": 0, "qty": 2}, {"index": 1, "qty": 1}]],                          # <2 groups
        [[{"index": 5, "qty": 1}], [{"index": 0, "qty": 2}]],                        # bad index
    ])
    def test_items_split_invalid(self, s, groups):
        o = mk(s, [line("A", 100, 2, 5), line("B", 200, 1, 18)])
        r = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "items", "groups": groups})
        assert r.status_code == 400, r.text
        assert s.get(f"{API}/orders/{o['id']}").json().get("splits") in ([], None)

    def test_parts_validation(self, s):
        o = mk(s, [line()])
        assert s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 1}).status_code == 422

    def test_undo_split(self, s):
        o = mk(s, [line()])
        s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2})
        r = s.delete(f"{API}/orders/{o['id']}/split")
        assert r.status_code == 200 and r.json()["splits"] == [] and r.json()["payment_mode"] == "Pending"
        # now plain pay works again
        assert s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500}).status_code == 200


# ---------- Split payments ----------
class TestSplitPay:
    def test_full_split_flow(self, s):
        o = mk(s, [line("A", 100, 3, 5)], order_type="Dine-In", table_no="T3")  # 315
        d = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 3}).json()
        sp = d["splits"]
        r = s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500})
        assert r.status_code == 400 and "split" in r.json()["detail"].lower()
        # tendered < share
        assert s.post(f"{API}/orders/{o['id']}/pay/cash?split_id={sp[0]['id']}", json={"tendered": 50}).status_code == 400
        r = s.post(f"{API}/orders/{o['id']}/pay/cash?split_id={sp[0]['id']}", json={"tendered": 200})
        assert r.status_code == 200 and r.json()["change"] == 95.0 and r.json()["order_paid"] is False
        assert s.post(f"{API}/orders/{o['id']}/pay/cash?split_id={sp[0]['id']}", json={"tendered": 200}).status_code == 400
        assert s.delete(f"{API}/orders/{o['id']}/split").status_code == 400
        assert s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}).status_code == 400
        g = s.get(f"{API}/orders/{o['id']}").json()
        assert g["payment_status"] == "Partial"
        t = tbl(s, "T3")
        assert t["status"] == "Billed" and t["running_total"] == 210.0
        r = s.post(f"{API}/orders/{o['id']}/pay/card?split_id={sp[1]['id']}", json={"reference": "C1"})
        assert r.status_code == 200 and r.json()["order_paid"] is False
        r = s.post(f"{API}/orders/{o['id']}/pay/upi/initiate?split_id={sp[2]['id']}")
        assert r.status_code == 200 and r.json()["amount"] == 105.0 and "am=105.00" in r.json()["upi_string"]
        st = s.get(f"{API}/orders/{o['id']}/pay/upi/status?split_id={sp[2]['id']}").json()
        assert st["payment_status"] == "Pending" and st["order_payment_status"] == "Partial"
        for _ in range(12):
            time.sleep(2)
            st = s.get(f"{API}/orders/{o['id']}/pay/upi/status?split_id={sp[2]['id']}").json()
            if st["payment_status"] == "Paid":
                break
        assert st["payment_status"] == "Paid" and st["payment_mode"] == "UPI"
        assert st["order_payment_status"] == "Paid"
        assert tbl(s, "T3")["status"] == "Free"
        # unknown split id
        assert s.get(f"{API}/orders/{o['id']}/pay/upi/status?split_id=nope").status_code == 404

    def test_report_counts_split_modes(self, s):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        rep = s.get(f"{API}/reports/daily", params={"date": today, "tz_offset": 0}).json()
        modes = {m["mode"]: m for m in rep["payment_modes"]}
        assert "Split" not in modes
        assert modes["Card"]["amount"] >= 105.0 and modes["UPI"]["amount"] >= 105.0


# ---------- Move / merge ----------
class TestMoveMerge:
    def test_move_to_free(self, s):
        h = s.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T1", "items": [line("A", 100, 1)]}).json()
        r = s.post(f"{API}/tables/move", json={"from_table": "T1", "to_table": "T2"})
        assert r.status_code == 200 and r.json()["action"] == "moved"
        assert tbl(s, "T1")["status"] == "Free"
        t2 = tbl(s, "T2")
        assert t2["status"] == "Occupied" and t2["held_order"]["id"] == h["id"]

    def test_merge_into_busy(self, s):
        s.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T4", "items": [line("A", 100, 2), line("B", 50, 1)]})
        r = s.post(f"{API}/tables/move", json={"from_table": "T4", "to_table": "T2"})
        assert r.status_code == 200 and r.json()["action"] == "merged"
        assert tbl(s, "T4")["status"] == "Free"
        h = tbl(s, "T2")["held_order"]
        qty = {i["name"]: i["qty"] for i in h["items"]}
        assert qty == {"A": 3, "B": 1}
        assert h["subtotal"] == 350.0 and h["total"] == 367.5
        assert len([x for x in s.get(f"{API}/held-orders").json() if x["table_no"] in ("T2", "T4")]) == 1

    def test_move_open_orders(self, s):
        o = mk(s, [line()], order_type="Dine-In", table_no="T5")
        s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2})
        sp = s.get(f"{API}/orders/{o['id']}").json()["splits"]
        s.post(f"{API}/orders/{o['id']}/pay/card?split_id={sp[0]['id']}", json={"reference": "x"})
        r = s.post(f"{API}/tables/move", json={"from_table": "T5", "to_table": "T6"})
        assert r.status_code == 200 and r.json()["action"] == "moved"
        assert s.get(f"{API}/orders/{o['id']}").json()["table_no"] == "T6"
        assert tbl(s, "T6")["status"] == "Billed"

    def test_move_errors(self, s):
        assert s.post(f"{API}/tables/move", json={"from_table": "T2", "to_table": "T2"}).status_code == 400
        assert s.post(f"{API}/tables/move", json={"from_table": "T2", "to_table": "ZZ"}).status_code == 404
        r = s.post(f"{API}/tables/move", json={"from_table": "T8", "to_table": "T7"})
        assert r.status_code == 400 and "no open bill" in r.json()["detail"]


# ---------- Monthly GST ----------
class TestMonthly:
    @pytest.fixture(scope="class", autouse=True)
    def seed(self, s):
        o = mk(s, [line("A", 100, 2, 5), line("B", 200, 1, 18)])
        s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 1000})
        c = mk(s, [line()])
        s.put(f"{API}/orders/{c['id']}/status", json={"order_status": "Cancelled"})
        s.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": [line("Biryani", 320, 1, 5)]})

    def test_monthly_json(self, s):
        r = s.get(f"{API}/reports/monthly", params={"month": MONTH, "tz_offset": -330})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["gstin"] == GSTIN and d["place_of_supply"] == "29-Karnataka"
        for k in ("summary", "gstr3b", "b2cs", "hsn", "docs", "eco", "daily"):
            assert k in d
        sm = d["summary"]
        assert sm["eco_taxable"] == 320.0
        assert round(sm["pos_cgst"] + sm["pos_sgst"], 2) == sm["pos_tax"]
        assert all(h["hsn"] == "996331" for h in d["hsn"])
        assert {b["rate"] for b in d["b2cs"]} == {5.0, 18.0}
        # iter5: docs row uses INV series; cancelled bills never consume a number
        assert d["docs"][0]["cancelled"] == 0 and d["docs"][0]["total"] >= 1
        assert d["docs"][0]["from"].startswith("INV") and sm["cancelled_invoices"] >= 1
        assert d["eco"][0]["operator"] == "Swiggy"
        assert round(sum(x["taxable"] for x in d["b2cs"]), 2) == sm["pos_taxable"]
        assert len(d["gstr3b"]) == 2 and d["gstr3b"][0]["taxable"] == sm["pos_taxable"]

    def test_bad_month(self, s):
        assert s.get(f"{API}/reports/monthly", params={"month": "2025-13"}).status_code == 400
        assert s.get(f"{API}/reports/monthly", params={"month": "abc"}).status_code == 400

    @pytest.mark.parametrize("kind,header", [
        ("b2cs", ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"]),
        ("hsn", ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value",
                 "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"]),
        ("docs", ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"]),
    ])
    def test_csv_kinds(self, s, kind, header):
        r = s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": kind, "tz_offset": -330})
        assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
        rows = list(csv.reader(io.StringIO(r.text)))
        assert rows[0] == header and len(rows) >= 2

    def test_csv_full_and_invalid(self, s):
        r = s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": "full"})
        assert r.status_code == 200 and GSTIN in r.text and "GSTR-3B" in r.text and "29-Karnataka" in r.text
        assert s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": "xyz"}).status_code == 422


# ---------- Regression: plain cash + daily report ----------
def test_regression_plain_cash(s):
    o = mk(s, [line()])
    r = s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 300})
    assert r.status_code == 200 and r.json()["change"] == 90.0
    g = s.get(f"{API}/orders/{o['id']}").json()
    assert g["payment_status"] == "Paid" and g["payment_mode"] == "Cash"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    assert s.get(f"{API}/reports/daily/csv", params={"date": today}).status_code == 200
