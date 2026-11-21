# Probe: concurrent orders on a tracked item (oversell) and partial aggregator_settings update
import os, uuid, requests
from concurrent.futures import ThreadPoolExecutor
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
u = f"test_{uuid.uuid4().hex[:8]}"
requests.post(f"{API}/stores/register", json={"store_name": "TEST_Probe", "username": u, "password": "pw12345"})
s = requests.Session()
s.headers["Authorization"] = "Bearer " + requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
s.post(f"{API}/menu/quick-pack")
it = next(m for m in s.get(f"{API}/menu").json() if m["name"] == "Samosa")
s.post(f"{API}/menu/{it['id']}/stock", json={"mode": "set", "qty": 3})
body = {"order_type": "Takeaway", "items": [{"item_id": it["id"], "name": "Samosa", "qty": 2, "price": 15, "tax_rate": 5}]}
with ThreadPoolExecutor(6) as ex:
    codes = list(ex.map(lambda _: requests.post(f"{API}/orders", json=body, headers=s.headers).status_code, range(6)))
print("concurrent codes (stock 3, qty 2 each):", codes, "sold:", 2 * codes.count(200))
print("stock after:", next(m for m in s.get(f"{API}/menu").json() if m["id"] == it["id"])["stock_qty"])
s.put(f"{API}/stores/me", json={"aggregator_settings": {"Swiggy": {"commission_percent": 22}, "Zomato": {"commission_percent": 30}}})
s.put(f"{API}/stores/me", json={"aggregator_settings": {"Swiggy": {"commission_percent": 15}}})
print("zomato after Swiggy-only update:", s.get(f"{API}/auth/me").json()["aggregator_settings"]["Zomato"])
