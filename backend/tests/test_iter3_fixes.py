# Iteration 3 retest: payment guards, held-bill table clash, table/held validation & 404s, discount GST, floor bill count
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def fresh():
    u = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/stores/register", json={"store_name": "TEST_Iter3", "username": u,
                                                       "password": "pw12345", "gst_number": "GSTI3"})
    assert r.status_code == 200, r.text
    return _login(u, "pw12345")


def line(name="TEST Paneer", price=100.0, qty=2, rate=5.0):
    return {"item_id": f"x-{name}", "name": name, "qty": qty, "price": price, "tax_rate": rate}


def table(s, name):
    return next(t for t in s.get(f"{API}/tables").json() if t["name"] == name)


# ---------- Payment guards ----------
class TestPaymentGuards:
    def test_double_pay_rejected(self, fresh):
        o = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line()]}).json()
        assert fresh.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 300}).status_code == 200
        for path, body in (("cash", {"tendered": 300}), ("card", {"reference": "R1"}), ("upi/initiate", None)):
            r = fresh.post(f"{API}/orders/{o['id']}/pay/{path}", json=body)
            assert r.status_code == 400, (path, r.text)
            assert "already paid" in r.json()["detail"].lower()
        got = fresh.get(f"{API}/orders/{o['id']}").json()
        assert got["payment_mode"] == "Cash" and got["payment_status"] == "Paid"

    def test_cancelled_pay_rejected(self, fresh):
        o = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [line()]}).json()
        fresh.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"})
        for path, body in (("cash", {"tendered": 300}), ("card", {"reference": "R1"}), ("upi/initiate", None)):
            r = fresh.post(f"{API}/orders/{o['id']}/pay/{path}", json=body)
            assert r.status_code == 400, (path, r.text)
        assert fresh.get(f"{API}/orders/{o['id']}").json()["payment_status"] == "Pending"

    def test_unknown_order_pay_404(self, fresh):
        assert fresh.post(f"{API}/orders/nope/pay/cash", json={"tendered": 1}).status_code == 404


# ---------- Held bill clash ----------
class TestHeldClash:
    def test_move_held_to_occupied_table_rejected(self, fresh):
        a = fresh.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T1", "items": [line()]}).json()
        b = fresh.post(f"{API}/held-orders", json={"order_type": "Dine-In", "table_no": "T2", "items": [line(qty=1)]}).json()
        r = fresh.post(f"{API}/held-orders", json={"id": a["id"], "order_type": "Dine-In", "table_no": "T2", "items": [line(qty=5)]})
        assert r.status_code == 400
        assert r.json()["detail"] == "Table T2 already has a held bill"
        held = fresh.get(f"{API}/held-orders").json()
        assert len([h for h in held if h["table_no"] == "T2"]) == 1
        assert next(h for h in held if h["id"] == b["id"])["total"] == 105.0
        assert next(h for h in held if h["id"] == a["id"])["table_no"] == "T1"

    def test_move_held_to_free_table_ok(self, fresh):
        a = next(h for h in fresh.get(f"{API}/held-orders").json() if h["table_no"] == "T1")
        r = fresh.post(f"{API}/held-orders", json={"id": a["id"], "order_type": "Dine-In", "table_no": "T3", "items": [line()]})
        assert r.status_code == 200 and r.json()["id"] == a["id"] and r.json()["table_no"] == "T3"
        assert table(fresh, "T1")["status"] == "Free" and table(fresh, "T3")["status"] == "Occupied"


# ---------- Validation / 404s ----------
class TestValidation:
    def test_delete_unknown_table_404(self, fresh):
        assert fresh.delete(f"{API}/tables/{uuid.uuid4()}").status_code == 404

    def test_delete_table_with_held_400(self, fresh):
        t3 = table(fresh, "T3")
        assert t3["status"] == "Occupied"
        assert fresh.delete(f"{API}/tables/{t3['id']}").status_code == 400
        assert table(fresh, "T3")

    def test_delete_table_with_pending_400(self, fresh):
        fresh.post(f"{API}/orders", json={"order_type": "Dine-In", "table_no": "T4", "items": [line()]})
        t4 = table(fresh, "T4")
        assert t4["status"] == "Billed"
        assert fresh.delete(f"{API}/tables/{t4['id']}").status_code == 400

    def test_delete_unknown_held_404(self, fresh):
        assert fresh.delete(f"{API}/held-orders/{uuid.uuid4()}").status_code == 404

    @pytest.mark.parametrize("body", [{"name": "", "seats": 4}, {"name": "X1", "seats": 0}, {"name": "X2", "seats": -2}])
    def test_create_table_invalid_422(self, fresh, body):
        assert fresh.post(f"{API}/tables", json=body).status_code == 422

    def test_create_table_whitespace_name(self, fresh):
        assert fresh.post(f"{API}/tables", json={"name": "   ", "seats": 2}).status_code in (400, 422)

    def test_held_invalid_order_type_422(self, fresh):
        r = fresh.post(f"{API}/held-orders", json={"order_type": "Delivery", "table_no": "T5", "items": [line()]})
        assert r.status_code == 422


# ---------- Floor bill count data ----------
class TestFloorMultiBill:
    def test_multiple_pending_on_table(self, fresh):
        for _ in range(2):
            fresh.post(f"{API}/orders", json={"order_type": "Dine-In", "table_no": "T6", "items": [line()]})
        t6 = table(fresh, "T6")
        assert t6["status"] == "Billed" and len(t6["pending_orders"]) == 2 and t6["running_total"] == 420.0


# ---------- Discount GST ----------
class TestDiscountGst:
    def test_order_discount_tax(self, fresh):
        # 2x100@5% + 1x200@18% = 400 subtotal, discount 40 -> ratio .9 ; tax = (10+36)*.9 = 41.4 ; total = 360+41.4
        o = fresh.post(f"{API}/orders", json={"order_type": "Takeaway", "discount": 40,
                                              "items": [line(), line("TEST Wine", 200, 1, 18)]}).json()
        assert o["subtotal"] == 400 and o["discount"] == 40 and o["tax"] == 41.4 and o["total"] == 401.4
        assert fresh.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 500}).status_code == 200

    def test_report_reflects_discount(self, fresh):
        d = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        rep = fresh.get(f"{API}/reports/daily", params={"date": d, "tz_offset": 0}).json()
        s = rep["summary"]
        # paid: first test 210 (no discount) + 401.4 discounted
        assert s["paid_orders"] == 2, s
        assert s["taxable_value"] == 200 + 360
        assert s["discount"] == 40
        assert s["total_tax"] == 10 + 41.4
        rates = {g["rate"]: g for g in rep["gst_breakdown"]}
        assert rates[5.0]["taxable"] == 200 + 180 and rates[18.0]["taxable"] == 180.0
        assert rates[18.0]["total_tax"] == 32.4
        assert round(sum(g["total_tax"] for g in rep["gst_breakdown"]), 2) == s["total_tax"]
