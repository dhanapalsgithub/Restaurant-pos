"""Multi-tenant Restaurant Billing POS - FastAPI Backend
Features: JWT per-store auth, menu/order CRUD, Razorpay dynamic UPI QR,
UrbanPiper webhook routing via WebSockets, demo mode for payments.
"""
from fastapi import FastAPI, APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timezone, timedelta
import os, logging, uuid, asyncio, hmac, hashlib, json, bcrypt, jwt, base64, io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALG = os.environ.get("JWT_ALG", "HS256")
DEMO_MODE = os.environ.get("DEMO_PAYMENT_MODE", "true").lower() == "true"

app = FastAPI(title="Multi-tenant Restaurant POS")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("pos")
logging.basicConfig(level=logging.INFO)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ====================== MODELS ======================
class StoreIn(BaseModel):
    store_name: str
    username: str
    password: str
    address: Optional[str] = ""
    phone: Optional[str] = ""
    gst_number: Optional[str] = ""
    urbanpiper_store_id: Optional[str] = ""
    urbanpiper_api_key: Optional[str] = ""
    razorpay_key_id: Optional[str] = ""
    razorpay_key_secret: Optional[str] = ""
    upi_vpa: Optional[str] = ""


class Store(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    store_name: str
    username: str
    address: str = ""
    phone: str = ""
    gst_number: str = ""
    urbanpiper_store_id: str = ""
    urbanpiper_api_key: str = ""
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    upi_vpa: str = ""
    created_at: str = Field(default_factory=now_iso)


class LoginIn(BaseModel):
    username: str
    password: str


class Category(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    store_id: str
    name: str
    sort_order: int = 0


class CategoryIn(BaseModel):
    name: str
    sort_order: int = 0


class MenuItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    store_id: str
    category_id: str
    name: str
    description: str = ""
    price: float
    tax_rate: float = 5.0
    image_url: str = ""
    is_available: bool = True
    is_veg: bool = True


class MenuItemIn(BaseModel):
    category_id: str
    name: str
    description: str = ""
    price: float
    tax_rate: float = 5.0
    image_url: str = ""
    is_available: bool = True
    is_veg: bool = True


class OrderLine(BaseModel):
    item_id: str
    name: str
    qty: int
    price: float
    tax_rate: float = 5.0
    notes: str = ""


class OrderIn(BaseModel):
    order_type: str  # Dine-In | Takeaway | Swiggy | Zomato
    items: List[OrderLine]
    table_no: Optional[str] = ""
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    notes: Optional[str] = ""
    discount: float = 0.0


class Order(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    store_id: str
    order_number: str
    order_type: str
    channel: str = "POS"  # POS | Swiggy | Zomato
    items: List[Dict[str, Any]]
    subtotal: float
    tax: float
    discount: float = 0.0
    total: float
    payment_mode: str = "Pending"  # Cash | Card | UPI | Online
    payment_status: str = "Pending"  # Pending | Paid | Failed
    payment_ref: str = ""
    gateway_order_id: str = ""
    gateway_payment_id: str = ""
    order_status: str = "Placed"  # Placed | Accepted | Preparing | Ready | Dispatched | Completed | Cancelled
    table_no: str = ""
    customer_name: str = ""
    customer_phone: str = ""
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class PayCashIn(BaseModel):
    tendered: float


class PayCardIn(BaseModel):
    reference: str


class StatusUpdateIn(BaseModel):
    order_status: str


# ====================== AUTH ======================
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(store_id: str, username: str) -> str:
    payload = {
        "sub": store_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_store(creds: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    store = await db.stores.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not store:
        raise HTTPException(401, "Store not found")
    return store


# ====================== WEBSOCKET MANAGER ======================
class WSManager:
    def __init__(self):
        self.active: Dict[str, List[WebSocket]] = {}

    async def connect(self, store_id: str, ws: WebSocket):
        await ws.accept()
        self.active.setdefault(store_id, []).append(ws)

    def disconnect(self, store_id: str, ws: WebSocket):
        if store_id in self.active and ws in self.active[store_id]:
            self.active[store_id].remove(ws)

    async def broadcast(self, store_id: str, message: dict):
        for ws in list(self.active.get(store_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(store_id, ws)


ws_manager = WSManager()


# ====================== HELPERS ======================
async def _calc_totals(items: List[Dict[str, Any]], discount: float = 0.0):
    subtotal = sum(i["price"] * i["qty"] for i in items)
    tax = sum((i["price"] * i["qty"]) * (i.get("tax_rate", 5.0) / 100.0) for i in items)
    total = round(subtotal + tax - discount, 2)
    return round(subtotal, 2), round(tax, 2), total


async def _next_order_number(store_id: str) -> str:
    count = await db.orders.count_documents({"store_id": store_id})
    return f"ORD{(count + 1):05d}"


# ====================== ROUTES: AUTH / STORE ======================
@api.get("/")
async def root():
    return {"message": "Restaurant POS API", "demo_mode": DEMO_MODE}


@api.post("/stores/register")
async def register_store(data: StoreIn):
    exists = await db.stores.find_one({"username": data.username})
    if exists:
        raise HTTPException(400, "Username already taken")
    store = Store(**data.model_dump(exclude={"password"}))
    doc = store.model_dump()
    doc["password_hash"] = hash_pw(data.password)
    await db.stores.insert_one(doc)
    return {"id": store.id, "store_name": store.store_name, "username": store.username}


@api.post("/auth/login")
async def login(data: LoginIn):
    store = await db.stores.find_one({"username": data.username})
    if not store or not verify_pw(data.password, store.get("password_hash", "")):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(store["id"], store["username"])
    return {
        "token": token,
        "store": {k: v for k, v in store.items() if k not in ("_id", "password_hash")},
    }


@api.get("/auth/me")
async def me(current=Depends(get_current_store)):
    return current


@api.put("/stores/me")
async def update_store(data: dict, current=Depends(get_current_store)):
    allowed = {"store_name", "address", "phone", "gst_number", "urbanpiper_store_id",
               "urbanpiper_api_key", "razorpay_key_id", "razorpay_key_secret", "upi_vpa"}
    upd = {k: v for k, v in data.items() if k in allowed}
    await db.stores.update_one({"id": current["id"]}, {"$set": upd})
    return {"ok": True}


# ====================== ROUTES: CATEGORIES ======================
@api.get("/categories")
async def list_categories(current=Depends(get_current_store)):
    docs = await db.categories.find({"store_id": current["id"]}, {"_id": 0}).sort("sort_order", 1).to_list(500)
    return docs


@api.post("/categories")
async def create_category(data: CategoryIn, current=Depends(get_current_store)):
    cat = Category(store_id=current["id"], **data.model_dump())
    await db.categories.insert_one(cat.model_dump())
    return cat.model_dump()


@api.delete("/categories/{cid}")
async def delete_category(cid: str, current=Depends(get_current_store)):
    await db.categories.delete_one({"id": cid, "store_id": current["id"]})
    await db.menu_items.delete_many({"category_id": cid, "store_id": current["id"]})
    return {"ok": True}


# ====================== ROUTES: MENU ITEMS ======================
@api.get("/menu")
async def list_menu(current=Depends(get_current_store)):
    docs = await db.menu_items.find({"store_id": current["id"]}, {"_id": 0}).to_list(2000)
    return docs


@api.post("/menu")
async def create_item(data: MenuItemIn, current=Depends(get_current_store)):
    item = MenuItem(store_id=current["id"], **data.model_dump())
    await db.menu_items.insert_one(item.model_dump())
    return item.model_dump()


@api.put("/menu/{iid}")
async def update_item(iid: str, data: dict, current=Depends(get_current_store)):
    allowed = {"name", "description", "price", "tax_rate", "image_url", "is_available", "is_veg", "category_id"}
    upd = {k: v for k, v in data.items() if k in allowed}
    await db.menu_items.update_one({"id": iid, "store_id": current["id"]}, {"$set": upd})
    return {"ok": True}


@api.delete("/menu/{iid}")
async def delete_item(iid: str, current=Depends(get_current_store)):
    await db.menu_items.delete_one({"id": iid, "store_id": current["id"]})
    return {"ok": True}


@api.post("/menu/{iid}/toggle-stock")
async def toggle_stock(iid: str, current=Depends(get_current_store)):
    item = await db.menu_items.find_one({"id": iid, "store_id": current["id"]}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Item not found")
    new_val = not item["is_available"]
    await db.menu_items.update_one({"id": iid}, {"$set": {"is_available": new_val}})
    # Sync to UrbanPiper (mock)
    logger.info(f"[UrbanPiper SYNC] store={current['id']} item={iid} available={new_val}")
    return {"ok": True, "is_available": new_val, "synced_to_urbanpiper": True}


# ====================== ROUTES: ORDERS ======================
@api.get("/orders")
async def list_orders(limit: int = 100, status_filter: Optional[str] = None, current=Depends(get_current_store)):
    q = {"store_id": current["id"]}
    if status_filter:
        q["order_status"] = status_filter
    docs = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api.get("/orders/{oid}")
async def get_order(oid: str, current=Depends(get_current_store)):
    doc = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Order not found")
    return doc


@api.post("/orders")
async def create_order(data: OrderIn, current=Depends(get_current_store)):
    items_dicts = [i.model_dump() for i in data.items]
    subtotal, tax, total = await _calc_totals(items_dicts, data.discount)
    order = Order(
        store_id=current["id"],
        order_number=await _next_order_number(current["id"]),
        order_type=data.order_type,
        channel="POS",
        items=items_dicts,
        subtotal=subtotal, tax=tax, discount=data.discount, total=total,
        table_no=data.table_no or "", customer_name=data.customer_name or "",
        customer_phone=data.customer_phone or "", notes=data.notes or "",
    )
    await db.orders.insert_one(order.model_dump())
    await ws_manager.broadcast(current["id"], {"type": "order_created", "order": order.model_dump()})
    return order.model_dump()


@api.put("/orders/{oid}/status")
async def update_status(oid: str, data: StatusUpdateIn, current=Depends(get_current_store)):
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    await db.orders.update_one(
        {"id": oid}, {"$set": {"order_status": data.order_status, "updated_at": now_iso()}}
    )
    # UrbanPiper sync for Swiggy/Zomato
    if order.get("channel") in ("Swiggy", "Zomato"):
        logger.info(f"[UrbanPiper SYNC] order={oid} status={data.order_status}")
    await ws_manager.broadcast(current["id"], {"type": "order_updated", "order_id": oid, "status": data.order_status})
    return {"ok": True}


# ====================== PAYMENT: CASH / CARD / UPI ======================
@api.post("/orders/{oid}/pay/cash")
async def pay_cash(oid: str, data: PayCashIn, current=Depends(get_current_store)):
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    change = round(data.tendered - order["total"], 2)
    await db.orders.update_one({"id": oid}, {"$set": {
        "payment_mode": "Cash", "payment_status": "Paid",
        "payment_ref": f"CASH-TENDERED-{data.tendered:.2f}",
        "updated_at": now_iso(),
    }})
    await ws_manager.broadcast(current["id"], {"type": "payment_success", "order_id": oid, "mode": "Cash"})
    return {"ok": True, "change": change}


@api.post("/orders/{oid}/pay/card")
async def pay_card(oid: str, data: PayCardIn, current=Depends(get_current_store)):
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    await db.orders.update_one({"id": oid}, {"$set": {
        "payment_mode": "Card", "payment_status": "Paid",
        "payment_ref": data.reference, "updated_at": now_iso(),
    }})
    await ws_manager.broadcast(current["id"], {"type": "payment_success", "order_id": oid, "mode": "Card"})
    return {"ok": True}


@api.post("/orders/{oid}/pay/upi/initiate")
async def pay_upi_initiate(oid: str, current=Depends(get_current_store)):
    """Create a Razorpay order and return UPI deep-link + QR payload.
    In DEMO_MODE, returns a mock UPI string that can be rendered as QR.
    Frontend polls /status to detect payment.
    """
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    amount_paise = int(round(order["total"] * 100))
    rzp_order_id = ""
    upi_string = ""

    key_id = current.get("razorpay_key_id") or os.environ.get("RAZORPAY_KEY_ID", "")
    key_secret = current.get("razorpay_key_secret") or os.environ.get("RAZORPAY_KEY_SECRET", "")
    vpa = current.get("upi_vpa") or "merchant@upi"

    if key_id and key_secret and not DEMO_MODE:
        try:
            import razorpay
            rzp = razorpay.Client(auth=(key_id, key_secret))
            rzp_order = rzp.order.create({
                "amount": amount_paise, "currency": "INR",
                "receipt": order["order_number"][:40], "payment_capture": 1,
            })
            rzp_order_id = rzp_order["id"]
        except Exception as e:
            logger.exception("Razorpay create failed, falling back to demo UPI string: %s", e)

    # Build UPI deeplink (standard EMV / UPI intent URL)
    upi_string = (
        f"upi://pay?pa={vpa}&pn={order.get('store_id','Store').replace(' ','%20')}"
        f"&am={order['total']:.2f}&cu=INR&tn={order['order_number']}"
    )

    await db.orders.update_one({"id": oid}, {"$set": {
        "payment_mode": "UPI", "gateway_order_id": rzp_order_id, "updated_at": now_iso(),
    }})

    # In demo mode auto-mark paid after 12s to simulate QR scan success
    if DEMO_MODE:
        asyncio.create_task(_demo_auto_pay(current["id"], oid))

    return {
        "upi_string": upi_string, "amount": order["total"], "amount_paise": amount_paise,
        "razorpay_order_id": rzp_order_id, "demo_mode": DEMO_MODE,
        "order_number": order["order_number"],
    }


async def _demo_auto_pay(store_id: str, order_id: str, delay: int = 12):
    await asyncio.sleep(delay)
    order = await db.orders.find_one({"id": order_id, "store_id": store_id}, {"_id": 0})
    if order and order.get("payment_status") != "Paid":
        pid = f"pay_demo_{uuid.uuid4().hex[:12]}"
        await db.orders.update_one({"id": order_id}, {"$set": {
            "payment_status": "Paid", "payment_mode": "UPI",
            "gateway_payment_id": pid, "payment_ref": pid, "updated_at": now_iso(),
        }})
        await ws_manager.broadcast(store_id, {
            "type": "payment_success", "order_id": order_id, "mode": "UPI", "payment_id": pid,
        })


@api.get("/orders/{oid}/pay/upi/status")
async def pay_upi_status(oid: str, current=Depends(get_current_store)):
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    return {"payment_status": order["payment_status"], "payment_mode": order["payment_mode"],
            "payment_ref": order.get("payment_ref", "")}


# ====================== RAZORPAY WEBHOOK ======================
@api.post("/webhooks/razorpay")
async def razorpay_webhook(request: Request, x_razorpay_signature: Optional[str] = Header(None)):
    body = await request.body()
    secret = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
    if secret:
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, x_razorpay_signature or ""):
            raise HTTPException(400, "Invalid signature")
    payload = json.loads(body.decode() or "{}")
    event = payload.get("event", "")
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    rzp_order_id = entity.get("order_id", "")
    pay_id = entity.get("id", "")
    if event == "payment.captured" and rzp_order_id:
        order = await db.orders.find_one({"gateway_order_id": rzp_order_id}, {"_id": 0})
        if order:
            await db.orders.update_one({"id": order["id"]}, {"$set": {
                "payment_status": "Paid", "gateway_payment_id": pay_id,
                "payment_ref": pay_id, "updated_at": now_iso(),
            }})
            await ws_manager.broadcast(order["store_id"], {
                "type": "payment_success", "order_id": order["id"],
                "mode": "UPI", "payment_id": pay_id,
            })
    return {"ok": True}


# ====================== URBANPIPER WEBHOOK ======================
@api.post("/webhooks/urbanpiper")
async def urbanpiper_webhook(request: Request):
    """Mock-compatible UrbanPiper webhook. Expected payload shape (simplified):
    { "store_ref": "<urbanpiper_store_id>", "channel": "swiggy|zomato",
      "order_id": "...", "items": [{"name":"","qty":1,"price":100,"tax_rate":5}],
      "customer_name": "...", "customer_phone": "...", "total": 123.0,
      "payment_status": "Paid"  # pre-paid online }
    """
    payload = await request.json()
    store_ref = payload.get("store_ref") or payload.get("store_id")
    if not store_ref:
        raise HTTPException(400, "store_ref missing")
    store = await db.stores.find_one({"urbanpiper_store_id": store_ref}, {"_id": 0})
    if not store:
        raise HTTPException(404, f"Store not found for ref {store_ref}")

    items = payload.get("items", [])
    subtotal, tax, total = await _calc_totals(items)
    total = payload.get("total", total)
    channel = payload.get("channel", "Swiggy").capitalize()

    order = Order(
        store_id=store["id"],
        order_number=await _next_order_number(store["id"]),
        order_type=channel, channel=channel, items=items,
        subtotal=subtotal, tax=tax, total=total,
        payment_mode="Online", payment_status=payload.get("payment_status", "Paid"),
        order_status="Placed", customer_name=payload.get("customer_name", ""),
        customer_phone=payload.get("customer_phone", ""), notes=payload.get("notes", ""),
    )
    await db.orders.insert_one(order.model_dump())
    await ws_manager.broadcast(store["id"], {
        "type": "online_order", "order": order.model_dump(), "channel": channel,
    })
    return {"ok": True, "order_id": order.id}


# Convenience: let the frontend simulate an incoming Swiggy/Zomato order
@api.post("/simulate/online-order")
async def simulate_online_order(data: dict, current=Depends(get_current_store)):
    channel = data.get("channel", "Swiggy").capitalize()
    items = data.get("items") or [
        {"name": "Sample Item", "qty": 1, "price": 199.0, "tax_rate": 5.0}
    ]
    subtotal, tax, total = await _calc_totals(items)
    order = Order(
        store_id=current["id"], order_number=await _next_order_number(current["id"]),
        order_type=channel, channel=channel, items=items,
        subtotal=subtotal, tax=tax, total=total,
        payment_mode="Online", payment_status="Paid", order_status="Placed",
        customer_name=data.get("customer_name", "Online Customer"),
        customer_phone=data.get("customer_phone", "9999999999"),
    )
    await db.orders.insert_one(order.model_dump())
    await ws_manager.broadcast(current["id"], {
        "type": "online_order", "order": order.model_dump(), "channel": channel,
    })
    return order.model_dump()


# ====================== DASHBOARD ======================
@api.get("/dashboard")
async def dashboard(current=Depends(get_current_store)):
    today = datetime.now(timezone.utc).date().isoformat()
    all_orders = await db.orders.find({"store_id": current["id"]}, {"_id": 0}).to_list(5000)
    todays = [o for o in all_orders if o["created_at"].startswith(today)]
    total_sales = sum(o["total"] for o in todays if o["payment_status"] == "Paid")
    channels = {"POS": 0, "Swiggy": 0, "Zomato": 0}
    modes = {"Cash": 0, "Card": 0, "UPI": 0, "Online": 0, "Pending": 0}
    for o in todays:
        channels[o.get("channel", "POS")] = channels.get(o.get("channel", "POS"), 0) + 1
        modes[o.get("payment_mode", "Pending")] = modes.get(o.get("payment_mode", "Pending"), 0) + 1
    return {
        "today_sales": round(total_sales, 2),
        "today_orders": len(todays),
        "channels": channels, "payment_modes": modes,
        "recent": sorted(todays, key=lambda x: x["created_at"], reverse=True)[:10],
    }


# ====================== WEBSOCKET ======================
@app.websocket("/api/ws/{token}")
async def ws_endpoint(ws: WebSocket, token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        store_id = payload["sub"]
    except Exception:
        await ws.close(code=1008)
        return
    await ws_manager.connect(store_id, ws)
    try:
        await ws.send_json({"type": "connected", "store_id": store_id})
        while True:
            await ws.receive_text()  # keep-alive pings from client
    except WebSocketDisconnect:
        ws_manager.disconnect(store_id, ws)


# ====================== SEED ======================
@app.on_event("startup")
async def seed_demo():
    existing = await db.stores.find_one({"username": "demo"})
    if existing:
        return
    store = Store(
        store_name="Spice Garden Demo", username="demo",
        address="12 MG Road, Bengaluru", phone="+91 9876543210",
        gst_number="29ABCDE1234F1Z5", urbanpiper_store_id="UP-DEMO-001",
        upi_vpa="spicegarden@upi",
    )
    doc = store.model_dump()
    doc["password_hash"] = hash_pw("demo123")
    await db.stores.insert_one(doc)

    cats = [
        Category(store_id=store.id, name="Starters", sort_order=1),
        Category(store_id=store.id, name="Main Course", sort_order=2),
        Category(store_id=store.id, name="Breads", sort_order=3),
        Category(store_id=store.id, name="Beverages", sort_order=4),
        Category(store_id=store.id, name="Desserts", sort_order=5),
    ]
    for c in cats:
        await db.categories.insert_one(c.model_dump())

    img = {
        "Starters": "https://images.unsplash.com/photo-1551782450-17144efb9c50?w=400",
        "Main Course": "https://images.unsplash.com/photo-1727404679933-99daa2a7573a?w=400",
        "Breads": "https://images.unsplash.com/photo-1712757248842-04f6e3844374?w=400",
        "Beverages": "https://images.unsplash.com/photo-1551782450-17144efb9c50?w=400",
        "Desserts": "https://images.pexels.com/photos/35123985/pexels-photo-35123985.jpeg?w=400",
    }
    items = [
        ("Starters", "Paneer Tikka", 240, True),
        ("Starters", "Chicken 65", 280, False),
        ("Starters", "Veg Spring Roll", 180, True),
        ("Main Course", "Chicken Biryani", 320, False),
        ("Main Course", "Paneer Butter Masala", 290, True),
        ("Main Course", "Dal Makhani", 220, True),
        ("Main Course", "Mutton Rogan Josh", 420, False),
        ("Breads", "Butter Naan", 60, True),
        ("Breads", "Garlic Naan", 80, True),
        ("Breads", "Tandoori Roti", 40, True),
        ("Beverages", "Masala Chai", 40, True),
        ("Beverages", "Fresh Lime Soda", 80, True),
        ("Beverages", "Mango Lassi", 120, True),
        ("Desserts", "Gulab Jamun", 100, True),
        ("Desserts", "Rasmalai", 140, True),
    ]
    cat_map = {c.name: c.id for c in cats}
    for cat_name, name, price, is_veg in items:
        it = MenuItem(
            store_id=store.id, category_id=cat_map[cat_name], name=name,
            price=price, is_veg=is_veg, image_url=img.get(cat_name, ""),
        )
        await db.menu_items.insert_one(it.model_dump())
    logger.info("Seeded demo store (user=demo pw=demo123)")


# ====================== REGISTER ======================
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("shutdown")
async def _shutdown():
    mongo_client.close()
