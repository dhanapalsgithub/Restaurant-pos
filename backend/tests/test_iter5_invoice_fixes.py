# Iteration 5: POS invoice series, rate formatting in CSVs, cancel guard, double-pay race guard
import csv
import io
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
GSTIN = "29ABCDE1234F1Z5"
MONTH = datetime.now(timezone.utc).strftime("%Y-%m")


@pytest.fixture(scope="module")
def s():
    u = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/stores/register", json={"store_name": "TEST_Iter5", "username": u,
                                                       "password": "pw12345", "gst_number": GSTIN})
    assert r.status_code == 200, r.text
    tok = requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
    ss = requests.Session()
    ss.headers.update({"Authorization": f"Bearer {tok}"})
    ss.token = tok
    return ss


def line(name="TEST A", price=100.0, qty=2, rate=5.0):
    return {"item_id": f"x-{name}", "name": name, "qty": qty, "price": price, "tax_rate": rate}


def mk(s, items=None):
    r = s.post(f"{API}/orders", json={"order_type": "Takeaway", "items": items or [line()], "discount": 0})
    assert r.status_code == 200, r.text
    return r.json()


def get(s, oid):
    return s.get(f"{API}/orders/{oid}").json()


def inv_num(x):
    assert x and x.startswith("INV") and len(x) == 9, x
    return int(x[3:])


# ---------- Invoice series ----------
class TestInvoiceSeries:
    def test_sequential_no_gaps_across_modes(self, s):
        o1, o2, o3, o4 = mk(s), mk(s), mk(s), mk(s)
        # unpaid has no invoice
        assert not get(s, o1["id"]).get("invoice_no")
        assert s.post(f"{API}/orders/{o1['id']}/pay/cash", json={"tendered": 500}).status_code == 200
        # cancelled order in between must not consume a number
        assert s.put(f"{API}/orders/{o2['id']}/status", json={"order_status": "Cancelled"}).status_code == 200
        assert s.post(f"{API}/orders/{o3['id']}/pay/card", json={"reference": "C"}).status_code == 200
        # split order: invoice only after last share
        sp = s.post(f"{API}/orders/{o4['id']}/split", json={"mode": "equal", "parts": 2}).json()["splits"]
        s.post(f"{API}/orders/{o4['id']}/pay/card?split_id={sp[0]['id']}", json={"reference": "x"})
        assert not get(s, o4["id"]).get("invoice_no")
        s.post(f"{API}/orders/{o4['id']}/pay/cash?split_id={sp[1]['id']}", json={"tendered": 500})
        n1, n3, n4 = (inv_num(get(s, o["id"]).get("invoice_no")) for o in (o1, o3, o4))
        assert get(s, o2["id"]).get("invoice_no") in (None, "")
        assert n1 == 1 and n3 == 2 and n4 == 3  # fresh store starts at 1

    def test_online_orders_get_no_invoice(self, s):
        r = s.post(f"{API}/simulate/online-order", json={"channel": "Zomato", "items": [line("Biryani", 320, 1)]})
        assert r.status_code == 200, r.text
        oid = r.json().get("id") or r.json().get("order", {}).get("id")
        o = get(s, oid)
        assert o["channel"] == "Zomato" and not o.get("invoice_no")

    def test_monthly_docs_row(self, s):
        d = s.get(f"{API}/reports/monthly", params={"month": MONTH, "tz_offset": -330}).json()
        doc = d["docs"][0]
        assert doc["from"] == "INV000001"
        assert doc["cancelled"] == 0 and doc["total"] == doc["net_issued"]
        assert inv_num(doc["to"]) - inv_num(doc["from"]) + 1 == doc["total"]
        assert d["summary"]["cancelled_invoices"] >= 1
        rows = list(csv.reader(io.StringIO(s.get(f"{API}/reports/monthly/csv",
                                                   params={"month": MONTH, "kind": "docs", "tz_offset": -330}).text)))
        assert rows[1][1] == "INV000001" and rows[1][4] == "0"

    def test_demo_store_backfilled(self):
        tok = requests.post(f"{API}/auth/login", json={"username": "demo", "password": "demo123"}).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        d = requests.get(f"{API}/reports/monthly", params={"month": MONTH, "tz_offset": -330}, headers=h).json()
        doc = d["docs"][0]
        if doc["total"]:
            assert doc["from"].startswith("INV") and doc["cancelled"] == 0


# ---------- CSV rate formatting ----------
class TestRateFormat:
    def test_whole_rates(self, s):
        o = mk(s, [line("A", 100, 1, 5), line("B", 100, 1, 18)])
        s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 1000})
        b = list(csv.reader(io.StringIO(s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": "b2cs"}).text)))
        assert {r[3] for r in b[1:]} == {"5", "18"}
        h = list(csv.reader(io.StringIO(s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": "hsn"}).text)))
        assert {r[5] for r in h[1:]} == {"5", "18"}
        full = s.get(f"{API}/reports/monthly/csv", params={"month": MONTH, "kind": "full"}).text
        assert ",5.0," not in full and ",18.0," not in full


# ---------- Cancel guard ----------
class TestCancelGuard:
    def test_paid_cannot_cancel(self, s):
        o = mk(s)
        s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500})
        r = s.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"})
        assert r.status_code == 400
        assert get(s, o["id"])["order_status"] != "Cancelled"

    def test_partial_cannot_cancel(self, s):
        o = mk(s)
        sp = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}).json()["splits"]
        s.post(f"{API}/orders/{o['id']}/pay/card?split_id={sp[0]['id']}", json={"reference": "x"})
        assert get(s, o["id"])["payment_status"] == "Partial"
        r = s.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"})
        assert r.status_code == 400
        assert get(s, o["id"])["order_status"] != "Cancelled"

    def test_pending_can_cancel_and_paid_status_change_ok(self, s):
        o = mk(s)
        assert s.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"}).status_code == 200
        p = mk(s)
        s.post(f"{API}/orders/{p['id']}/pay/cash", json={"tendered": 500})
        assert s.put(f"{API}/orders/{p['id']}/status", json={"order_status": "Completed"}).status_code in (200, 422)


# ---------- Double-pay guard ----------
class TestDoublePay:
    def test_share_already_paid(self, s):
        o = mk(s)
        sp = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}).json()["splits"]
        assert s.post(f"{API}/orders/{o['id']}/pay/card?split_id={sp[0]['id']}", json={"reference": "x"}).status_code == 200
        r = s.post(f"{API}/orders/{o['id']}/pay/card?split_id={sp[0]['id']}", json={"reference": "x"})
        assert r.status_code == 400 and "already paid" in r.json()["detail"].lower()

    def test_fully_paid_order_rejected(self, s):
        o = mk(s)
        s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500})
        r = s.post(f"{API}/orders/{o['id']}/pay/card", json={"reference": "x"})
        assert r.status_code == 400
        assert get(s, o["id"])["payment_mode"] == "Cash"

    def test_concurrent_same_share(self, s):
        o = mk(s)
        sp = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}).json()["splits"]
        url = f"{API}/orders/{o['id']}/pay/card?split_id={sp[0]['id']}"
        h = {"Authorization": f"Bearer {s.token}"}
        with ThreadPoolExecutor(6) as ex:
            codes = list(ex.map(lambda _: requests.post(url, json={"reference": "r"}, headers=h).status_code, range(6)))
        assert codes.count(200) == 1, codes
        g = get(s, o["id"])
        assert g["payment_status"] == "Partial" and g["payment_ref"] == "1/2 shares paid"

    def test_concurrent_full_order(self, s):
        o = mk(s)
        url = f"{API}/orders/{o['id']}/pay/cash"
        h = {"Authorization": f"Bearer {s.token}"}
        with ThreadPoolExecutor(6) as ex:
            codes = list(ex.map(lambda _: requests.post(url, json={"tendered": 500}, headers=h).status_code, range(6)))
        assert codes.count(200) == 1, codes

    def test_concurrent_last_two_shares_no_gap(self, s):
        """Two different shares paid concurrently: order must end Paid with exactly one invoice and no gap."""
        before = mk(s)
        s.post(f"{API}/orders/{before['id']}/pay/cash", json={"tendered": 500})
        n0 = inv_num(get(s, before["id"])["invoice_no"])
        o = mk(s)
        sp = s.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}).json()["splits"]
        h = {"Authorization": f"Bearer {s.token}"}
        urls = [f"{API}/orders/{o['id']}/pay/card?split_id={x['id']}" for x in sp]
        with ThreadPoolExecutor(2) as ex:
            codes = list(ex.map(lambda u: requests.post(u, json={"reference": "r"}, headers=h).status_code, urls))
        assert codes == [200, 200]
        g = get(s, o["id"])
        assert g["payment_status"] == "Paid", g["payment_status"]
        after = mk(s)
        s.post(f"{API}/orders/{after['id']}/pay/cash", json={"tendered": 500})
        assert inv_num(g["invoice_no"]) == n0 + 1
        assert inv_num(get(s, after["id"])["invoice_no"]) == n0 + 2
