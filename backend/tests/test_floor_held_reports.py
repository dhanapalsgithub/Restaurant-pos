# Regression tests for iteration 2 features: Tables floor, Held orders, Daily sales report (+CSV)
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def demo():
    return _login("demo", "demo123")


@pytest.fixture(scope="module")
def fresh():
    """Fresh tenant so report numbers are deterministic"""
    u = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/stores/register", json={"store_name": "TEST_Store", "username": u,
                                                       "password": "pw12345", "gst_number": "GSTTEST"})
    assert r.status_code == 200, r.text
    return _login(u, "pw12345")


def line(name="TEST Paneer", price=100.0, qty=2, rate=5.0):
    return {"item_id": f"x-{name}", "name": name, "qty": qty, "price": price, "tax_rate": rate}


def table(s, name):
    return next(t for t in s.get(f"{API}/tables").json() if t["name"] == name)


# ---------- Tables ----------
class TestTables:
    def test_demo_has_seeded_tables(self, demo):
        r = demo.get(f"{API}/tables")
        assert r.status_code == 200
        names = [t["name"] for t in r.json()]
        for i in range(1, 9):
            assert f"T{i}" in names
        for t in r.json():
            assert t["status"] in ("Free", "Occupied", "Billed")
            for k in ("running_total", "held_order", "pending_orders", "since"):
                assert k in t
            assert "_id" not in t

    def test_fresh_store_gets_8_tables(self, fresh):
        ts = fresh.get(f"{API}/tables").json()
        assert [t["name"] for t in ts] == [f"T{i}" for i in range(1, 9)]
        assert all(t["status"] == "Free" and t["running_total"] == 0 for t in ts)

    def test_add_duplicate_delete_table(self, fresh):
        r = fresh.post(f"{API}/tables", json={"name": "TEST_P1", "seats": 2})
        assert r.status_code == 200
        tid = r.json()["id"]
        assert "_id" not in r.json()
        assert fresh.post(f"{API}/tables", json={"name": "TEST_P1"}).status_code == 400
        assert any(t["id"] == tid for t in fresh.get(f"{API}/tables").json())
        assert fresh.delete(f"{API}/tables/{tid}").status_code == 200
        assert not any(t["id"] == tid for t in fresh.get(f"{API}/tables").json())


# ---------- Held orders + table status ----------
class TestHeldAndStatus:
    def test_hold_upsert_and_table_states(self, fresh):
        r = fresh.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T3", "items": [line()]})
        assert r.status_code == 200, r.text
        h = r.json()
        assert h["total"] == 210.0 and h["table_no"] == "T3"
        # same table -> update, not duplicate
        r2 = fresh.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T3", "items": [line(qty=3)]})
        assert r2.json()["id"] == h["id"] and r2.json()["total"] == 315.0
        # by id -> update
        r3 = fresh.post(f"{API}/held-orders", json={"id": h["id"], "order_type": "Dine-In", "table_no": "T3", "items": [line(qty=1)]})
        assert r3.json()["id"] == h["id"]
        held = [x for x in fresh.get(f"{API}/held-orders").json() if x["table_no"] == "T3"]
        assert len(held) == 1 and held[0]["total"] == 105.0
        t3 = table(fresh, "T3")
        assert t3["status"] == "Occupied" and t3["running_total"] == 105.0 and t3["since"]
        # delete held -> free
        assert fresh.delete(f"{API}/held-orders/{h['id']}").status_code == 200
        assert table(fresh, "T3")["status"] == "Free"
        assert not any(x["id"] == h["id"] for x in fresh.get(f"{API}/held-orders").json())

    def test_empty_hold_rejected(self, fresh):
        r = fresh.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T4", "items": []})
        assert r.status_code == 400

    def test_takeaway_hold_has_no_table(self, fresh):
        r = fresh.post(f"{API}/held-orders", json={"order_type": "Takeaway", "table_no": "T5", "items": [line()]})
        assert r.status_code == 200 and r.json()["table_no"] == ""
        assert table(fresh, "T5")["status"] == "Free"
        fresh.delete(f"{API}/held-orders/{r.json()['id']}")

    def test_pending_order_billed_then_cancel_frees(self, fresh):
        o = fresh.post(f"{API}/orders", json={"order_type": "Dine-In", "table_no": "T6", "items": [line()]}).json()
        t6 = table(fresh, "T6")
        assert t6["status"] == "Billed" and t6["running_total"] == 210.0
        assert t6["pending_orders"][0]["id"] == o["id"]
        assert fresh.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"}).status_code == 200
        assert table(fresh, "T6")["status"] == "Free"

    def test_pending_order_paid_frees(self, fresh):
        o = fresh.post(f"{API}/orders", json={"order_type": "Dine-In", "table_no": "T7", "items": [line()]}).json()
        assert table(fresh, "T7")["status"] == "Billed"
        fresh.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500})
        assert table(fresh, "T7")["status"] == "Free"

    def test_tenant_isolation_held(self, demo, fresh):
        ids = {x["id"] for x in fresh.get(f"{API}/held-orders").json()}
        assert not ids & {x["id"] for x in demo.get(f"{API}/held-orders").json()}


# ---------- Daily report ----------
class TestReport:
    @pytest.fixture(scope="class")
    def seeded(self, fresh):
        # Paid cash: 2x100@5% -> 210 ; Paid card: 1x200@18% -> 236 ; pending 1x50@5% -> 52.5 ; cancelled paid -> excluded
        a = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line()]}).json()
        fresh.post(f"{API}/orders/{a['id']}/pay/cash", json={"tendered": 300})
        b = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line("TEST Wine", 200, 1, 18)]}).json()
        fresh.post(f"{API}/orders/{b['id']}/pay/card", json={"reference": "TESTREF"})
        fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line("TEST Tea", 50, 1, 5)]})
        c = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line("TEST Junk", 1000, 1, 5)]}).json()
        # iter4: paid POS orders can no longer be cancelled (400) -> cancel an unpaid one instead
        fresh.put(f"{API}/orders/{c['id']}/status", json={"order_status": "Cancelled"})
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def test_report_numbers(self, fresh, seeded):
        r = fresh.get(f"{API}/reports/daily", params={"date": seeded, "tz_offset": 0})
        assert r.status_code == 200, r.text
        d = r.json()
        s = d["summary"]
        # T7 order from earlier class (210 cash paid) also counts
        assert s["paid_orders"] == 3, s
        assert s["gross_sales"] == 656.0
        assert s["total_tax"] == 56.0 and s["cgst"] == 28.0 and s["sgst"] == 28.0
        assert s["taxable_value"] == 600.0
        assert s["pending_orders"] == 1 and s["pending_amount"] == 52.5
        assert s["avg_ticket"] == round(656 / 3, 2)
        rates = {g["rate"]: g for g in d["gst_breakdown"]}
        assert rates[5.0]["taxable"] == 400.0 and rates[5.0]["cgst"] == 10.0 and rates[5.0]["sgst"] == 10.0
        assert rates[18.0]["total_tax"] == 36.0 and rates[18.0]["cgst"] == 18.0
        modes = {m["mode"]: m for m in d["payment_modes"]}
        assert modes["Cash"]["count"] == 2 and modes["Card"]["amount"] == 236.0
        assert "TEST Junk" not in [i["name"] for i in d["top_items"]]
        assert d["top_items"][0]["name"] == "TEST Paneer"
        assert len(d["orders"]) == 4
        assert d["channels"][0]["channel"] == "POS"

    def test_other_day_empty(self, fresh, seeded):
        y = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")
        s = fresh.get(f"{API}/reports/daily", params={"date": y}).json()["summary"]
        assert s["paid_orders"] == 0 and s["gross_sales"] == 0

    def test_tz_offset_shift(self, fresh, seeded):
        # with a huge offset (+1440 = next day window) today's orders vanish
        s = fresh.get(f"{API}/reports/daily", params={"date": seeded, "tz_offset": 1440}).json()["summary"]
        assert s["paid_orders"] == 0

    def test_bad_date(self, fresh):
        assert fresh.get(f"{API}/reports/daily", params={"date": "15-01-2026"}).status_code == 400
        assert fresh.get(f"{API}/reports/daily/csv", params={"date": "bad"}).status_code == 400

    def test_csv(self, fresh, seeded):
        r = fresh.get(f"{API}/reports/daily/csv", params={"date": seeded, "tz_offset": 0})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "attachment" in r.headers["content-disposition"] and f"sales-report-{seeded}.csv" in r.headers["content-disposition"]
        for sec in ("SUMMARY", "GST BREAKDOWN", "PAYMENT MODES", "ORDERS"):
            assert sec in r.text
        assert "GSTTEST" in r.text and "656.0" in r.text

    def test_requires_auth(self):
        assert requests.get(f"{API}/reports/daily", params={"date": "2026-01-01"}).status_code in (401, 403)
        assert requests.get(f"{API}/tables").status_code in (401, 403)
