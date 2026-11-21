# Probe: legacy online order (no commission fields) is computed on the fly in reconciliation from current settings
import os, uuid, requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
u = f"test_{uuid.uuid4().hex[:8]}"
requests.post(f"{API}/stores/register", json={"store_name": "TEST_Legacy", "username": u, "password": "pw12345"})
tok = requests.post(f"{API}/auth/login", json={"username": u, "password": "pw12345"}).json()["token"]
h = {"Authorization": f"Bearer {tok}"}
sid = requests.get(f"{API}/auth/me", headers=h).json()["id"]
requests.put(f"{API}/stores/me", headers=h, json={"aggregator_settings": {"Zomato": {"commission_percent": 10, "gst_on_commission_percent": 18, "commission_base": "gross"}}})
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
oid = str(uuid.uuid4())
db.orders.insert_one({"id": oid, "store_id": sid, "order_number": "ORD00001", "order_type": "Zomato", "channel": "Zomato",
                      "items": [], "subtotal": 200, "tax": 10, "discount": 0, "total": 210, "payment_mode": "Online",
                      "payment_status": "Paid", "order_status": "Placed", "created_at": datetime.now(timezone.utc).isoformat()})
d0 = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d"); d1 = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
rep = requests.get(f"{API}/reports/reconciliation", headers=h, params={"start": d0, "end": d1}).json()
print("legacy row:", rep["orders"][0]["commission_amount"], rep["orders"][0]["net_receivable_amount"], "(expect 21.0, 185.22)")
r = requests.put(f"{API}/orders/{oid}/aggregator", headers=h, json={"tds_tcs_deduction": 1})
print("legacy override:", r.status_code, r.json().get("net_receivable_amount"), "(expect 184.22)")
db.orders.delete_one({"id": oid})
