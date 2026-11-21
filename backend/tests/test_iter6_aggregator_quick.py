# Iteration 6: aggregator commission/net receivable, payouts + reconciliation, quick pack, stock tracking
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
YDAY = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
TMRW = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
UPREF = f"UP-TEST-{uuid.uuid4().hex[:8]}"

SETTINGS = {"Swiggy": {"commission_percent": 22, "gst_on_commission_percent": 18, "commission_base": "subtotal",
                       "tds_tcs_percent": 1},
            "Zomato": {"commission_percent": 25, "gst_on_commission_percent": 18, "commission_base": "gross",
                       "tds_tcs_percent": 0}}


@pytest.fixture(scope="module")
def s():
    u = f"test_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/stores/register", json={"store_name": "TEST_Iter6", "username": u, "password": "pw12345"})
    assert r.status_code == 200, r.text
    tok = requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
    ss = requests.Session()
    ss.headers.update({"Authorization": f"Bearer {tok}"})
    r = ss.put(f"{API}/stores/me", json={"aggregator_settings": SETTINGS, "urbanpiper_store_id": UPREF})
    assert r.status_code == 200, r.text
    return ss


ITEMS = [{"name": "TEST Biryani", "qty": 2, "price": 100, "tax_rate": 5}]  # subtotal 200, tax 10, total 210


def r2(x):
    return round(x + 1e-9, 2)


# ---- aggregator settings ----
class TestAggSettings:
    def test_saved_both(self, s):
        me = s.get(f"{API}/auth/me").json()
        a = me["aggregator_settings"]
        assert a["Swiggy"]["commission_percent"] == 22 and a["Zomato"]["commission_base"] == "gross"

    @pytest.mark.parametrize("bad", [{"Swiggy": {"commission_percent": 101}}, {"Swiggy": {"commission_percent": -1}},
                                     {"Zomato": {"commission_base": "net"}}, {"Swiggy": {"tds_tcs_percent": 200}}])
    def test_invalid(self, s, bad):
        r = s.put(f"{API}/stores/me", json={"aggregator_settings": bad})
        assert r.status_code in (400, 422), r.text
        a = s.get(f"{API}/auth/me").json()["aggregator_settings"]
        assert a["Swiggy"]["commission_percent"] == 22

    def test_invalid_business_type(self, s):
        assert s.put(f"{API}/stores/me", json={"business_type": "Casino"}).status_code == 400


# ---- order calc ----
class TestAggCalc:
    def test_simulate_swiggy_subtotal(self, s):
        o = s.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": ITEMS,
                                                          "discount_borne_by_restaurant": 20}).json()
        assert o["platform_order_id"].startswith("SWI-")
        assert o["gross_order_amount"] == 210
        assert o["commission_amount"] == 44.0  # 22% of 200
        assert o["gst_on_commission"] == 7.92
        assert o["tds_tcs_deduction"] == 2.0
        assert o["net_receivable_amount"] == r2(210 - 44 - 7.92 - 20 - 2)
        g = s.get(f"{API}/orders/{o['id']}").json()
        assert g["net_receivable_amount"] == o["net_receivable_amount"]

    def test_webhook_zomato_gross(self, s):
        r = requests.post(f"{API}/webhooks/urbanpiper", json={"store_ref": UPREF, "channel": "zomato", "order_id": "ZTEST-1",
                                                              "items": ITEMS, "discount_borne_by_restaurant": 10})
        assert r.status_code == 200, r.text
        o = s.get(f"{API}/orders/{r.json()['order_id']}").json()
        assert o["channel"] == "Zomato" and o["platform_order_id"] == "ZTEST-1"
        assert o["commission_amount"] == 52.5  # 25% of 210
        assert o["gst_on_commission"] == 9.45
        assert o["net_receivable_amount"] == r2(210 - 52.5 - 9.45 - 10)

    def test_webhook_unknown_store(self):
        r = requests.post(f"{API}/webhooks/urbanpiper", json={"store_ref": "UP-NOPE-XYZ", "items": ITEMS})
        assert r.status_code == 404

    def test_override_and_recalc(self, s):
        o = s.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": ITEMS}).json()
        r = s.put(f"{API}/orders/{o['id']}/aggregator", json={"commission_percent": 10, "commission_base": "gross",
                                                               "tds_tcs_deduction": 5})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["commission_amount"] == 21.0 and d["gst_on_commission"] == 3.78 and d["tds_tcs_deduction"] == 5
        assert d["net_receivable_amount"] == r2(210 - 21 - 3.78 - 5)
        g = s.get(f"{API}/orders/{o['id']}").json()
        assert g["commission_percent"] == 10 and g["net_receivable_amount"] == d["net_receivable_amount"]

    def test_override_errors(self, s):
        o = s.post(f"{API}/simulate/online-order", json={"channel": "Zomato", "items": ITEMS}).json()
        assert s.put(f"{API}/orders/{o['id']}/aggregator", json={"discount_borne_by_restaurant": 500}).status_code == 400
        assert s.put(f"{API}/orders/{o['id']}/aggregator", json={"commission_percent": 150}).status_code == 422
        assert s.put(f"{API}/orders/nope-{uuid.uuid4()}/aggregator", json={}).status_code == 404
        pos = s.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [
            {"item_id": "x", "name": "TEST X", "qty": 1, "price": 10, "tax_rate": 5}]}).json()
        assert s.put(f"{API}/orders/{pos['id']}/aggregator", json={"commission_percent": 5}).status_code == 400


# ---- payouts & reconciliation (fresh store to keep totals deterministic) ----
@pytest.fixture(scope="class")
def rs():
    u = f"test_{uuid.uuid4().hex[:8]}"
    requests.post(f"{API}/stores/register", json={"store_name": "TEST_Iter6R", "username": u, "password": "pw12345"})
    tok = requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
    ss = requests.Session()
    ss.headers.update({"Authorization": f"Bearer {tok}"})
    ss.put(f"{API}/stores/me", json={"aggregator_settings": SETTINGS})
    return ss


class TestPayoutsRecon:
    def test_payout_validation(self, rs):
        assert rs.post(f"{API}/payouts", json={"date": "2026-13-45", "platform": "Swiggy", "amount": 10}).status_code == 400
        assert rs.post(f"{API}/payouts", json={"date": TODAY, "platform": "Uber", "amount": 10}).status_code == 422
        assert rs.delete(f"{API}/payouts/{uuid.uuid4()}").status_code == 404

    def test_negative_amount_rejected(self, rs):
        # spec doesn't explicitly require; record behaviour
        r = rs.post(f"{API}/payouts", json={"date": TODAY, "platform": "Swiggy", "amount": -50})
        if r.status_code == 200:
            rs.delete(f"{API}/payouts/{r.json()['id']}")
        assert r.status_code in (400, 422), "negative payout amount accepted"

    def test_full_recon(self, rs):
        a = rs.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": ITEMS}).json()  # net 210-44-7.92-2
        b = rs.post(f"{API}/simulate/online-order", json={"channel": "Zomato", "items": ITEMS}).json()
        c = rs.post(f"{API}/simulate/online-order", json={"channel": "Zomato", "items": ITEMS}).json()
        d = rs.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": ITEMS}).json()  # unsettled
        x = rs.post(f"{API}/simulate/online-order", json={"channel": "Swiggy", "items": ITEMS}).json()  # cancelled
        assert rs.put(f"{API}/orders/{x['id']}/status", json={"order_status": "Cancelled"}).status_code == 200
        p1 = rs.post(f"{API}/payouts", json={"date": TODAY, "platform": "Swiggy", "amount": a["net_receivable_amount"] - 0.5,
                                             "order_ref": a["platform_order_id"], "reference": "UTR1"})
        assert p1.status_code == 200 and p1.json()["date"] == TODAY
        bulk = rs.post(f"{API}/payouts/bulk", json={"rows": [
            {"date": TODAY, "platform": "Zomato", "amount": b["net_receivable_amount"] - 20, "order_ref": b["order_number"]},
            {"date": TODAY, "platform": "Zomato", "amount": c["net_receivable_amount"] + 5, "order_ref": c["platform_order_id"]},
        ]})
        assert bulk.status_code == 200 and bulk.json()["inserted"] == 2
        lst = rs.get(f"{API}/payouts", params={"start": TODAY, "end": TODAY}).json()
        assert len(lst) == 3
        rep = rs.get(f"{API}/reports/reconciliation", params={"start": YDAY, "end": TMRW, "tz_offset": 0}).json()
        st = {r["order_number"]: r["status"] for r in rep["orders"]}
        assert x["order_number"] not in st
        assert st[a["order_number"]] == "Matched"
        assert st[b["order_number"]] == "Short"
        assert st[c["order_number"]] == "Excess"
        assert st[d["order_number"]] == "Unsettled"
        sw = next(p for p in rep["platforms"] if p["platform"] == "Swiggy")
        assert sw["orders"] == 2
        assert sw["net_receivable_amount"] == r2(a["net_receivable_amount"] + d["net_receivable_amount"])
        assert sw["actual_received"] == r2(a["net_receivable_amount"] - 0.5)
        assert sw["difference"] == r2(sw["actual_received"] - sw["net_receivable_amount"])
        assert sw["total_deductions"] == r2(sw["commission_amount"] + sw["gst_on_commission"] +
                                            sw["discount_borne_by_restaurant"] + sw["tds_tcs_deduction"])
        assert rep["totals"]["orders"] == 4
        assert rep["totals"]["actual_received"] == r2(sum(p["amount"] for p in lst))
        csvr = rs.get(f"{API}/reports/reconciliation/csv", params={"start": YDAY, "end": TMRW})
        assert csvr.status_code == 200 and "text/csv" in csvr.headers["content-type"]
        assert a["order_number"] in csvr.text and "Unsettled" in csvr.text
        pid = p1.json()["id"]
        assert rs.delete(f"{API}/payouts/{pid}").status_code == 200
        assert len(rs.get(f"{API}/payouts", params={"start": TODAY, "end": TODAY}).json()) == 2

    def test_old_order_on_the_fly(self, rs):
        # Webhook-less legacy order: no commission_base -> not reachable via API; verify _with_agg path via recon totals only
        rep = rs.get(f"{API}/reports/reconciliation", params={"start": YDAY, "end": TMRW}).json()
        for o in rep["orders"]:
            assert o["net_receivable_amount"] is not None

    def test_recon_bad_date(self, rs):
        assert rs.get(f"{API}/reports/reconciliation", params={"start": "bad", "end": TODAY}).status_code == 400


# ---- quick pack, categories, stock ----
class TestQuickStock:
    def test_quick_pack_idempotent(self, s):
        r = s.post(f"{API}/menu/quick-pack").json()
        assert r["items_added"] == 22
        cats = s.get(f"{API}/categories").json()
        names = {c["name"]: c for c in cats}
        for n in ("Hot Beverages (Tea/Coffee)", "Juices & Shakes", "Bakery & Buns", "Hot Snacks (Puffs/Samosa/Bajji)"):
            assert n in names and names[n]["icon"] and names[n]["color"]
        menu = s.get(f"{API}/menu").json()
        tea = next(m for m in menu if m["name"] == "Tea")
        assert [m["name"] for m in tea["modifiers"]] == ["Strength", "Sugar"]
        lime = next(m for m in menu if m["name"] == "Fresh Lime Juice")
        assert any(o["label"] == "Extra Milk" and o["price"] == 10 for md in lime["modifiers"] for o in md["options"])
        samosa = next(m for m in menu if m["name"] == "Samosa")
        assert samosa["track_stock"] and samosa["stock_qty"] == 50
        assert s.post(f"{API}/menu/quick-pack").json()["items_added"] == 0

    def test_category_create_update(self, s):
        c = s.post(f"{API}/categories", json={"name": "TEST_Cat", "icon": "coffee", "color": "rose"}).json()
        assert c["icon"] == "coffee" and c["color"] == "rose"
        assert s.put(f"{API}/categories/{c['id']}", json={"name": "TEST_Cat2", "icon": "flame", "color": "lime"}).status_code == 200
        got = next(x for x in s.get(f"{API}/categories").json() if x["id"] == c["id"])
        assert got["name"] == "TEST_Cat2" and got["color"] == "lime"
        assert s.put(f"{API}/categories/{uuid.uuid4()}", json={"name": "x"}).status_code == 404

    def test_menu_put_validation(self, s):
        it = next(m for m in s.get(f"{API}/menu").json() if m["name"] == "Cream Bun")
        assert s.put(f"{API}/menu/{it['id']}", json={"stock_qty": -1}).status_code == 422
        assert s.put(f"{API}/menu/{it['id']}", json={"modifiers": [{"name": "Size", "options": []}]}).status_code == 422
        assert s.put(f"{API}/menu/{it['id']}", json={"modifiers": [{"name": "", "options": [{"label": "a"}]}]}).status_code == 422
        r = s.put(f"{API}/menu/{it['id']}", json={"track_stock": True, "stock_qty": 5, "low_stock_threshold": 3,
                                                  "modifiers": [{"name": "Size", "options": [{"label": "Normal", "price": 0},
                                                                                            {"label": "Big", "price": 5}]}]})
        assert r.status_code == 200
        g = next(m for m in s.get(f"{API}/menu").json() if m["id"] == it["id"])
        assert g["stock_qty"] == 5 and g["low_stock_threshold"] == 3 and g["modifiers"][0]["options"][1]["price"] == 5

    def test_stock_flow(self, s):
        it = next(m for m in s.get(f"{API}/menu").json() if m["name"] == "Veg Puff")
        assert s.post(f"{API}/menu/{it['id']}/stock", json={"mode": "set", "qty": 3}).json()["stock_qty"] == 3
        assert s.post(f"{API}/menu/{it['id']}/stock", json={"mode": "add", "qty": 2}).json()["stock_qty"] == 5
        assert s.post(f"{API}/menu/{it['id']}/stock", json={"mode": "set", "qty": -1}).status_code == 422
        line = lambda q: {"order_type": "Takeaway", "items": [{"item_id": it["id"], "name": "Veg Puff", "qty": q, "price": 20, "tax_rate": 5}]}
        r = s.post(f"{API}/orders", json=line(6))
        assert r.status_code == 400 and "Only 5 Veg Puff left in stock" in r.text
        o = s.post(f"{API}/orders", json=line(5)).json()
        g = next(m for m in s.get(f"{API}/menu").json() if m["id"] == it["id"])
        assert g["stock_qty"] == 0 and g["is_available"] is False
        low = [m["id"] for m in s.get(f"{API}/inventory/low").json()]
        assert it["id"] in low
        assert s.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"}).status_code == 200
        s.put(f"{API}/orders/{o['id']}/status", json={"order_status": "Cancelled"})
        g = next(m for m in s.get(f"{API}/menu").json() if m["id"] == it["id"])
        assert g["stock_qty"] == 5 and g["is_available"] is True

    def test_negative_qty_order_rejected(self, s):
        it = next(m for m in s.get(f"{API}/menu").json() if m["name"] == "Egg Puff")
        before = it["stock_qty"]
        r = s.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [
            {"item_id": it["id"], "name": "Egg Puff", "qty": -5, "price": 25, "tax_rate": 5}]})
        after = next(m for m in s.get(f"{API}/menu").json() if m["id"] == it["id"])["stock_qty"]
        assert r.status_code in (400, 422), f"negative qty accepted; stock {before}->{after}"

    def test_items_sold_daily(self, s):
        it = next(m for m in s.get(f"{API}/menu").json() if m["name"] == "Tea")
        o = s.post(f"{API}/orders", json={"order_type": "Takeaway", "items": [
            {"item_id": it["id"], "name": "Tea", "qty": 3, "price": 15, "tax_rate": 5}]}).json()
        before = s.get(f"{API}/reports/daily", params={"date": TODAY}).json()["summary"]["items_sold"]
        assert s.post(f"{API}/orders/{o['id']}/pay/cash", json={"tendered": 100}).status_code == 200
        after = s.get(f"{API}/reports/daily", params={"date": TODAY}).json()["summary"]["items_sold"]
        assert after == before + 3
