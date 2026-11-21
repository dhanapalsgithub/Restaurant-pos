# Probe: concurrent payment of the last two split shares (invoice gaps / stuck Partial)
import os, uuid, requests
from concurrent.futures import ThreadPoolExecutor
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
u = f"test_{uuid.uuid4().hex[:8]}"
requests.post(f"{API}/stores/register", json={"store_name": "TEST_Race", "username": u, "password": "pw12345", "gst_number": "29ABCDE1234F1Z5"})
tok = requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
h = {"Authorization": f"Bearer {tok}"}
it = [{"item_id": "x", "name": "A", "qty": 2, "price": 100, "tax_rate": 5}]
stuck, invs = 0, []
for i in range(30):
    o = requests.post(f"{API}/orders", json={"order_type": "Takeaway", "items": it}, headers=h).json()
    sp = requests.post(f"{API}/orders/{o['id']}/split", json={"mode": "equal", "parts": 2}, headers=h).json()["splits"]
    with ThreadPoolExecutor(2) as ex:
        codes = list(ex.map(lambda x: requests.post(f"{API}/orders/{o['id']}/pay/card?split_id={x['id']}", json={"reference": "r"}, headers=h).status_code, sp))
    g = requests.get(f"{API}/orders/{o['id']}", headers=h).json()
    if g["payment_status"] != "Paid":
        stuck += 1
        print("STUCK", i, codes, g["payment_status"], g["payment_ref"], [s["status"] for s in g["splits"]], g.get("invoice_no"))
    if g.get("invoice_no"):
        invs.append(int(g["invoice_no"][3:]))
print("stuck:", stuck, "/30")
gaps = [b for a, b in zip(invs, invs[1:]) if b != a + 1]
print("invoices:", invs[:5], "...", invs[-3:], "count", len(invs), "gaps at:", gaps)
