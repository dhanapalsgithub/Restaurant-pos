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
from typing import List, Optional, Dict, Any, Literal
from pathlib import Path
from datetime import datetime, timezone, timedelta
from fastapi.responses import Response
import os, logging, uuid, asyncio, hmac, hashlib, json, bcrypt, jwt, base64, io, csv

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
    splits: List[Dict[str, Any]] = []
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
    discount = min(max(discount, 0.0), subtotal)
    ratio = (subtotal - discount) / subtotal if subtotal else 1.0
    tax = sum((i["price"] * i["qty"]) * (i.get("tax_rate", 5.0) / 100.0) for i in items) * ratio
    total = round(subtotal - discount + tax, 2)
    return round(subtotal, 2), round(tax, 2), total


async def _payable_order(oid: str, store_id: str) -> Dict[str, Any]:
    order = await db.orders.find_one({"id": oid, "store_id": store_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["payment_status"] == "Paid":
        raise HTTPException(400, "Order is already paid")
    if order.get("order_status") == "Cancelled":
        raise HTTPException(400, "Order is cancelled")
    return order


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
    await _ensure_tables(store.id)
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
    if data.order_status == "Cancelled" and order["payment_status"] == "Paid" and order.get("channel") == "POS":
        raise HTTPException(400, "Paid orders cannot be cancelled")
    await db.orders.update_one(
        {"id": oid}, {"$set": {"order_status": data.order_status, "updated_at": now_iso()}}
    )
    # UrbanPiper sync for Swiggy/Zomato
    if order.get("channel") in ("Swiggy", "Zomato"):
        logger.info(f"[UrbanPiper SYNC] order={oid} status={data.order_status}")
    await ws_manager.broadcast(current["id"], {"type": "order_updated", "order_id": oid, "status": data.order_status})
    return {"ok": True}


# ====================== SPLIT BILLS ======================
class SplitIn(BaseModel):
    mode: Literal["equal", "items"]
    parts: int = Field(default=2, ge=2, le=20)
    groups: List[List[Dict[str, int]]] = []


def _due(o: Dict[str, Any]) -> float:
    return round(o["total"] - sum(s["amount"] for s in o.get("splits") or [] if s["status"] == "Paid"), 2)


@api.post("/orders/{oid}/split")
async def split_order(oid: str, data: SplitIn, current=Depends(get_current_store)):
    order = await _payable_order(oid, current["id"])
    if any(s["status"] == "Paid" for s in order.get("splits") or []):
        raise HTTPException(400, "Some shares are already paid")
    total_p = int(round(order["total"] * 100))
    if data.mode == "equal":
        each, rem = divmod(total_p, data.parts)
        shares = [{"amount_p": each + (1 if i < rem else 0), "items": []} for i in range(data.parts)]
    else:
        lines = order["items"]
        if len(data.groups) < 2:
            raise HTTPException(400, "Need at least 2 guests")
        ratio = (order["subtotal"] - order.get("discount", 0)) / order["subtotal"] if order["subtotal"] else 1.0
        alloc = [0] * len(lines)
        shares = []
        for g in data.groups:
            its, amt = [], 0.0
            for e in g:
                idx, q = e.get("index", -1), e.get("qty", 0)
                if not (0 <= idx < len(lines)) or q <= 0:
                    raise HTTPException(400, "Invalid item allocation")
                alloc[idx] += q
                ln = lines[idx]
                amt += ln["price"] * q * (1 + ln.get("tax_rate", 5.0) / 100) * ratio
                its.append({"name": ln["name"], "qty": q, "price": ln["price"]})
            if not its:
                raise HTTPException(400, "Every guest needs at least one item")
            shares.append({"amount_p": int(round(amt * 100)), "items": its})
        if any(alloc[i] != lines[i]["qty"] for i in range(len(lines))):
            raise HTTPException(400, "Every item must be assigned exactly once")
        shares[-1]["amount_p"] += total_p - sum(s["amount_p"] for s in shares)
    splits = [{"id": str(uuid.uuid4()), "label": f"Guest {i + 1}", "amount": s["amount_p"] / 100,
               "items": s["items"], "status": "Pending", "mode": "", "ref": "", "gateway_order_id": ""}
              for i, s in enumerate(shares)]
    await db.orders.update_one({"id": oid}, {"$set": {"splits": splits, "payment_mode": "Split", "updated_at": now_iso()}})
    return await db.orders.find_one({"id": oid}, {"_id": 0})


@api.delete("/orders/{oid}/split")
async def undo_split(oid: str, current=Depends(get_current_store)):
    order = await _payable_order(oid, current["id"])
    if any(s["status"] == "Paid" for s in order.get("splits") or []):
        raise HTTPException(400, "Some shares are already paid")
    await db.orders.update_one({"id": oid}, {"$set": {"splits": [], "payment_mode": "Pending", "updated_at": now_iso()}})
    return await db.orders.find_one({"id": oid}, {"_id": 0})


async def _resolve_payment(oid: str, store_id: str, split_id: Optional[str]):
    order = await _payable_order(oid, store_id)
    splits = order.get("splits") or []
    if split_id:
        sp = next((s for s in splits if s["id"] == split_id), None)
        if not sp:
            raise HTTPException(404, "Share not found")
        if sp["status"] == "Paid":
            raise HTTPException(400, "Share already paid")
        return order, sp, sp["amount"]
    if splits:
        raise HTTPException(400, "Bill is split - pay each share")
    return order, None, order["total"]


async def _record_payment(store_id: str, order: Dict[str, Any], split: Optional[Dict[str, Any]],
                          mode: str, ref: str, payment_id: str = "") -> bool:
    ts = now_iso()
    if not split:
        await db.orders.update_one({"id": order["id"]}, {"$set": {
            "payment_mode": mode, "payment_status": "Paid", "payment_ref": ref,
            "gateway_payment_id": payment_id or order.get("gateway_payment_id", ""), "updated_at": ts,
        }})
        await ws_manager.broadcast(store_id, {"type": "payment_success", "order_id": order["id"], "mode": mode, "payment_id": payment_id})
        return True
    await db.orders.update_one({"id": order["id"], "splits.id": split["id"]}, {"$set": {
        "splits.$.status": "Paid", "splits.$.mode": mode, "splits.$.ref": ref, "splits.$.paid_at": ts, "updated_at": ts,
    }})
    fresh = await db.orders.find_one({"id": order["id"]}, {"_id": 0})
    paid_n = sum(1 for s in fresh["splits"] if s["status"] == "Paid")
    all_paid = paid_n == len(fresh["splits"])
    await db.orders.update_one({"id": order["id"]}, {"$set": {
        "payment_status": "Paid" if all_paid else "Partial",
        "payment_ref": f"{paid_n}/{len(fresh['splits'])} shares paid",
    }})
    await ws_manager.broadcast(store_id, {"type": "split_paid", "order_id": order["id"], "split_id": split["id"],
                                          "mode": mode, "all_paid": all_paid})
    if all_paid:
        await ws_manager.broadcast(store_id, {"type": "payment_success", "order_id": order["id"], "mode": "Split"})
    return all_paid


# ====================== PAYMENT: CASH / CARD / UPI ======================
@api.post("/orders/{oid}/pay/cash")
async def pay_cash(oid: str, data: PayCashIn, split_id: Optional[str] = None, current=Depends(get_current_store)):
    order, split, due = await _resolve_payment(oid, current["id"], split_id)
    if data.tendered < due:
        raise HTTPException(400, "Tendered amount is less than amount due")
    all_paid = await _record_payment(current["id"], order, split, "Cash", f"CASH-TENDERED-{data.tendered:.2f}")
    return {"ok": True, "change": round(data.tendered - due, 2), "order_paid": all_paid}


@api.post("/orders/{oid}/pay/card")
async def pay_card(oid: str, data: PayCardIn, split_id: Optional[str] = None, current=Depends(get_current_store)):
    order, split, _ = await _resolve_payment(oid, current["id"], split_id)
    all_paid = await _record_payment(current["id"], order, split, "Card", data.reference)
    return {"ok": True, "order_paid": all_paid}


@api.post("/orders/{oid}/pay/upi/initiate")
async def pay_upi_initiate(oid: str, split_id: Optional[str] = None, current=Depends(get_current_store)):
    """Create a Razorpay order and return UPI deep-link + QR payload.
    In DEMO_MODE, returns a mock UPI string that can be rendered as QR.
    Frontend polls /status to detect payment.
    """
    order, split, due = await _resolve_payment(oid, current["id"], split_id)

    amount_paise = int(round(due * 100))
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
    note = order["order_number"] + (f"-{split['label'].replace(' ', '')}" if split else "")
    upi_string = (
        f"upi://pay?pa={vpa}&pn={current.get('store_name', 'Store').replace(' ', '%20')}"
        f"&am={due:.2f}&cu=INR&tn={note}"
    )

    if split:
        await db.orders.update_one({"id": oid, "splits.id": split["id"]}, {"$set": {
            "splits.$.gateway_order_id": rzp_order_id, "updated_at": now_iso(),
        }})
    else:
        await db.orders.update_one({"id": oid}, {"$set": {
            "payment_mode": "UPI", "gateway_order_id": rzp_order_id, "updated_at": now_iso(),
        }})

    # In demo mode auto-mark paid after 12s to simulate QR scan success
    if DEMO_MODE:
        asyncio.create_task(_demo_auto_pay(current["id"], oid, split["id"] if split else None))

    return {
        "upi_string": upi_string, "amount": due, "amount_paise": amount_paise,
        "razorpay_order_id": rzp_order_id, "demo_mode": DEMO_MODE,
        "order_number": order["order_number"],
    }


async def _demo_auto_pay(store_id: str, order_id: str, split_id: Optional[str] = None, delay: int = 12):
    await asyncio.sleep(delay)
    try:
        order, split, _ = await _resolve_payment(order_id, store_id, split_id)
    except HTTPException:
        return
    pid = f"pay_demo_{uuid.uuid4().hex[:12]}"
    await _record_payment(store_id, order, split, "UPI", pid, pid)


@api.get("/orders/{oid}/pay/upi/status")
async def pay_upi_status(oid: str, split_id: Optional[str] = None, current=Depends(get_current_store)):
    order = await db.orders.find_one({"id": oid, "store_id": current["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if split_id:
        sp = next((s for s in order.get("splits") or [] if s["id"] == split_id), None)
        if not sp:
            raise HTTPException(404, "Share not found")
        return {"payment_status": sp["status"], "payment_mode": sp["mode"], "payment_ref": sp.get("ref", ""),
                "order_payment_status": order["payment_status"]}
    return {"payment_status": order["payment_status"], "payment_mode": order["payment_mode"],
            "payment_ref": order.get("payment_ref", ""), "order_payment_status": order["payment_status"]}


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
        order = await db.orders.find_one(
            {"$or": [{"gateway_order_id": rzp_order_id}, {"splits.gateway_order_id": rzp_order_id}]}, {"_id": 0})
        if order:
            sp = next((s for s in order.get("splits") or [] if s.get("gateway_order_id") == rzp_order_id), None)
            try:
                order, split, _ = await _resolve_payment(order["id"], order["store_id"], sp["id"] if sp else None)
                await _record_payment(order["store_id"], order, split, "UPI", pay_id, pay_id)
            except HTTPException:
                pass
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


# ====================== TABLES (FLOOR VIEW) ======================
class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    seats: int = Field(default=4, ge=1, le=50)


class HeldOrderIn(BaseModel):
    id: Optional[str] = None
    order_type: Literal["Dine-In", "Takeaway"] = "Dine-In"
    table_no: str = ""
    label: str = ""
    items: List[OrderLine]


class MoveTableIn(BaseModel):
    from_table: str
    to_table: str


def _open_bill_q(store_id: str, table: Optional[str] = None) -> Dict[str, Any]:
    q = {"store_id": store_id, "order_type": "Dine-In", "payment_status": {"$in": ["Pending", "Partial"]},
         "order_status": {"$ne": "Cancelled"}, "table_no": table if table else {"$ne": ""}}
    return q


async def _ensure_tables(store_id: str, n: int = 8):
    if await db.tables.count_documents({"store_id": store_id}) == 0:
        docs = [{"id": str(uuid.uuid4()), "store_id": store_id, "name": f"T{i}",
                 "seats": 6 if i % 3 == 0 else 4, "sort_order": i} for i in range(1, n + 1)]
        await db.tables.insert_many(docs)


@api.get("/tables")
async def list_tables(current=Depends(get_current_store)):
    sid = current["id"]
    tables = await db.tables.find({"store_id": sid}, {"_id": 0}).sort("sort_order", 1).to_list(200)
    held = await db.held_orders.find({"store_id": sid, "order_type": "Dine-In", "table_no": {"$ne": ""}}, {"_id": 0}).to_list(500)
    pending = await db.orders.find(_open_bill_q(sid), {"_id": 0}).to_list(500)
    for t in tables:
        h = next((x for x in held if x["table_no"] == t["name"]), None)
        p = [o for o in pending if o["table_no"] == t["name"]]
        t["held_order"] = h
        t["pending_orders"] = p
        t["status"] = "Billed" if p else ("Occupied" if h else "Free")
        t["running_total"] = round((h["total"] if h else 0) + sum(_due(o) for o in p), 2)
        times = [x["created_at"] for x in ([h] if h else []) + p]
        t["since"] = min(times) if times else None
    return tables


@api.post("/tables")
async def create_table(data: TableIn, current=Depends(get_current_store)):
    name = data.name.strip()
    if not name:
        raise HTTPException(400, "Table name is required")
    if await db.tables.find_one({"store_id": current["id"], "name": name}):
        raise HTTPException(400, "Table name already exists")
    count = await db.tables.count_documents({"store_id": current["id"]})
    doc = {"id": str(uuid.uuid4()), "store_id": current["id"], "name": name,
           "seats": data.seats, "sort_order": count + 1}
    await db.tables.insert_one(doc.copy())
    return doc


@api.delete("/tables/{tid}")
async def delete_table(tid: str, current=Depends(get_current_store)):
    sid = current["id"]
    table = await db.tables.find_one({"id": tid, "store_id": sid}, {"_id": 0})
    if not table:
        raise HTTPException(404, "Table not found")
    busy = await db.held_orders.find_one({"store_id": sid, "order_type": "Dine-In", "table_no": table["name"]}) or \
        await db.orders.find_one(_open_bill_q(sid, table["name"]))
    if busy:
        raise HTTPException(400, "Table has an open bill")
    await db.tables.delete_one({"id": tid})
    return {"ok": True}


@api.post("/tables/move")
async def move_table(data: MoveTableIn, current=Depends(get_current_store)):
    sid = current["id"]
    src, dst = data.from_table, data.to_table
    if src == dst:
        raise HTTPException(400, "Choose a different table")
    names = {t["name"] for t in await db.tables.find({"store_id": sid, "name": {"$in": [src, dst]}}, {"_id": 0}).to_list(2)}
    if names != {src, dst}:
        raise HTTPException(404, "Table not found")
    held_q = lambda t: {"store_id": sid, "order_type": "Dine-In", "table_no": t}  # noqa: E731
    src_held = await db.held_orders.find_one(held_q(src), {"_id": 0})
    src_bills = await db.orders.count_documents(_open_bill_q(sid, src))
    if not src_held and not src_bills:
        raise HTTPException(400, f"Table {src} has no open bill")
    dst_held = await db.held_orders.find_one(held_q(dst), {"_id": 0})
    merged = bool(dst_held) or await db.orders.count_documents(_open_bill_q(sid, dst)) > 0
    if src_held and dst_held:
        lines: Dict[tuple, Dict[str, Any]] = {}
        for ln in dst_held["items"] + src_held["items"]:
            key = (ln["item_id"], ln["price"], ln.get("notes", ""))
            if key in lines:
                lines[key]["qty"] += ln["qty"]
            else:
                lines[key] = dict(ln)
        items = list(lines.values())
        subtotal, tax, total = await _calc_totals(items)
        await db.held_orders.update_one({"id": dst_held["id"]}, {"$set": {
            "items": items, "subtotal": subtotal, "tax": tax, "total": total, "updated_at": now_iso(),
            "created_at": min(dst_held["created_at"], src_held["created_at"]),
        }})
        await db.held_orders.delete_one({"id": src_held["id"]})
    elif src_held:
        await db.held_orders.update_one({"id": src_held["id"]}, {"$set": {"table_no": dst, "updated_at": now_iso()}})
    if src_bills:
        await db.orders.update_many(_open_bill_q(sid, src), {"$set": {"table_no": dst, "updated_at": now_iso()}})
    await ws_manager.broadcast(sid, {"type": "held_updated"})
    return {"ok": True, "action": "merged" if merged else "moved", "from_table": src, "to_table": dst}


# ====================== HELD ORDERS ======================
@api.get("/held-orders")
async def list_held(current=Depends(get_current_store)):
    return await db.held_orders.find({"store_id": current["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(500)


@api.post("/held-orders")
async def hold_order(data: HeldOrderIn, current=Depends(get_current_store)):
    items = [i.model_dump() for i in data.items]
    if not items:
        raise HTTPException(400, "Cannot hold an empty order")
    subtotal, tax, total = await _calc_totals(items)
    sid = current["id"]
    existing = None
    if data.id:
        existing = await db.held_orders.find_one({"id": data.id, "store_id": sid}, {"_id": 0})
    if not existing and data.order_type == "Dine-In" and data.table_no:
        existing = await db.held_orders.find_one({"store_id": sid, "order_type": "Dine-In", "table_no": data.table_no}, {"_id": 0})
    if data.order_type == "Dine-In" and data.table_no:
        clash = await db.held_orders.find_one({"store_id": sid, "order_type": "Dine-In", "table_no": data.table_no,
                                               "id": {"$ne": existing["id"] if existing else ""}})
        if clash:
            raise HTTPException(400, f"Table {data.table_no} already has a held bill")
    doc = {
        "store_id": sid, "order_type": data.order_type,
        "table_no": data.table_no if data.order_type == "Dine-In" else "",
        "label": data.label, "items": items,
        "subtotal": subtotal, "tax": tax, "total": total, "updated_at": now_iso(),
    }
    if existing:
        await db.held_orders.update_one({"id": existing["id"]}, {"$set": doc})
        doc["id"], doc["created_at"] = existing["id"], existing["created_at"]
    else:
        doc["id"], doc["created_at"] = str(uuid.uuid4()), now_iso()
        await db.held_orders.insert_one(doc.copy())
    await ws_manager.broadcast(sid, {"type": "held_updated"})
    return doc


@api.delete("/held-orders/{hid}")
async def delete_held(hid: str, current=Depends(get_current_store)):
    res = await db.held_orders.delete_one({"id": hid, "store_id": current["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Held order not found")
    await ws_manager.broadcast(current["id"], {"type": "held_updated"})
    return {"ok": True}


# ====================== DAILY SALES REPORT ======================
def _day_range(date_str: str, tz_offset: int):
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    start = d + timedelta(minutes=tz_offset)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def _gst_by_rate(orders: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    gst: Dict[float, Dict[str, float]] = {}
    for o in orders:
        ratio = (o["subtotal"] - o.get("discount", 0)) / o["subtotal"] if o["subtotal"] else 1.0
        for i in o["items"]:
            amt = i["price"] * i["qty"] * ratio
            rate = float(i.get("tax_rate", 5.0))
            g = gst.setdefault(rate, {"taxable": 0.0, "tax": 0.0, "qty": 0, "value": 0.0})
            g["taxable"] += amt
            g["tax"] += amt * rate / 100
            g["qty"] += i["qty"]
            g["value"] += amt * (1 + rate / 100)
    return [{"rate": r, "taxable": round(g["taxable"], 2), "cgst": round(g["tax"] / 2, 2), "sgst": round(g["tax"] / 2, 2),
             "total_tax": round(g["tax"], 2), "qty": g["qty"], "total_value": round(g["value"], 2)}
            for r, g in sorted(gst.items())]


def _bump(d: Dict[str, Dict[str, Any]], key: str, label: str, amt: float):
    r = d.setdefault(key, {label: key, "count": 0, "amount": 0.0})
    r["count"] += 1
    r["amount"] = round(r["amount"] + amt, 2)


async def _fetch_orders(store_id: str, start: str, end: str) -> List[Dict[str, Any]]:
    return await db.orders.find(
        {"store_id": store_id, "created_at": {"$gte": start, "$lt": end}}, {"_id": 0}
    ).sort("created_at", 1).to_list(50000)


def _aggregate(orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    live = [o for o in orders if o.get("order_status") != "Cancelled"]
    paid = [o for o in live if o["payment_status"] == "Paid"]
    pending = [o for o in live if o["payment_status"] in ("Pending", "Partial")]
    items_agg, modes, channels = {}, {}, {}
    for o in paid:
        for i in o["items"]:
            it = items_agg.setdefault(i["name"], {"name": i["name"], "qty": 0, "amount": 0.0})
            it["qty"] += i["qty"]
            it["amount"] += i["price"] * i["qty"]
        pays = [(s["mode"], s["amount"]) for s in o["splits"]] if o.get("splits") else [(o["payment_mode"], o["total"])]
        for mode, amt in pays:
            _bump(modes, mode, "mode", amt)
        _bump(channels, o.get("channel", "POS"), "channel", o["total"])
    gross = sum(o["total"] for o in paid)
    total_tax = sum(o["tax"] for o in paid)
    return {
        "summary": {
            "gross_sales": round(gross, 2),
            "taxable_value": round(sum(o["subtotal"] - o.get("discount", 0) for o in paid), 2),
            "total_tax": round(total_tax, 2),
            "cgst": round(total_tax / 2, 2), "sgst": round(total_tax / 2, 2),
            "discount": round(sum(o.get("discount", 0) for o in paid), 2),
            "paid_orders": len(paid),
            "pending_orders": len(pending),
            "pending_amount": round(sum(_due(o) for o in pending), 2),
            "avg_ticket": round(gross / len(paid), 2) if paid else 0.0,
        },
        "gst_breakdown": _gst_by_rate(paid),
        "payment_modes": list(modes.values()),
        "channels": list(channels.values()),
        "top_items": sorted(({**v, "amount": round(v["amount"], 2)} for v in items_agg.values()),
                            key=lambda x: x["amount"], reverse=True)[:10],
        "orders": paid + pending,
    }


async def _build_report(store_id: str, date: str, tz_offset: int):
    start, end = _day_range(date, tz_offset)
    return {"date": date, **_aggregate(await _fetch_orders(store_id, start, end))}


@api.get("/reports/daily")
async def daily_report(date: str, tz_offset: int = 0, current=Depends(get_current_store)):
    rep = await _build_report(current["id"], date, tz_offset)
    rep["orders"] = [{k: o.get(k) for k in ("id", "order_number", "created_at", "channel", "order_type", "table_no",
                                            "payment_mode", "payment_status", "subtotal", "tax", "discount", "total")}
                     for o in rep["orders"]]
    return rep


@api.get("/reports/daily/csv")
async def daily_report_csv(date: str, tz_offset: int = 0, current=Depends(get_current_store)):
    rep = await _build_report(current["id"], date, tz_offset)
    s = rep["summary"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Daily Sales Report", current.get("store_name", "")])
    w.writerow(["GSTIN", current.get("gst_number", "")])
    w.writerow(["Date", date])
    w.writerow([])
    w.writerow(["SUMMARY"])
    for label, key in [("Gross Sales", "gross_sales"), ("Taxable Value", "taxable_value"), ("CGST", "cgst"),
                       ("SGST", "sgst"), ("Total GST", "total_tax"), ("Discount", "discount"),
                       ("Paid Orders", "paid_orders"), ("Pending Orders", "pending_orders"),
                       ("Pending Amount", "pending_amount"), ("Average Ticket", "avg_ticket")]:
        w.writerow([label, s[key]])
    w.writerow([])
    w.writerow(["GST BREAKDOWN"])
    w.writerow(["GST Rate %", "Taxable Value", "CGST", "SGST", "Total GST"])
    for g in rep["gst_breakdown"]:
        w.writerow([g["rate"], g["taxable"], g["cgst"], g["sgst"], g["total_tax"]])
    w.writerow([])
    w.writerow(["PAYMENT MODES"])
    w.writerow(["Mode", "Orders", "Amount"])
    for m in rep["payment_modes"]:
        w.writerow([m["mode"], m["count"], round(m["amount"], 2)])
    w.writerow([])
    w.writerow(["ORDERS"])
    w.writerow(["Order #", "Time (UTC)", "Channel", "Type", "Table", "Payment Mode", "Payment Status",
                "Subtotal", "CGST", "SGST", "Discount", "Total"])
    for o in rep["orders"]:
        w.writerow([o["order_number"], o["created_at"], o.get("channel", ""), o["order_type"], o.get("table_no", ""),
                    o["payment_mode"], o["payment_status"], o["subtotal"], round(o["tax"] / 2, 2),
                    round(o["tax"] / 2, 2), o.get("discount", 0), o["total"]])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="sales-report-{date}.csv"'})


# ====================== MONTHLY GST REPORT ======================
GST_STATES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
    "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
    "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
    "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
    "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
    "97": "Other Territory",
}
RESTAURANT_SAC = "996331"
ECO_CHANNELS = ("Swiggy", "Zomato")


def _month_range(month: str, tz_offset: int):
    try:
        d = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "month must be YYYY-MM")
    nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    off = timedelta(minutes=tz_offset)
    return (d + off).isoformat(), (nxt + off).isoformat()


async def _build_monthly(store: Dict[str, Any], month: str, tz_offset: int) -> Dict[str, Any]:
    start, end = _month_range(month, tz_offset)
    orders = await _fetch_orders(store["id"], start, end)
    agg = _aggregate(orders)
    paid = [o for o in agg["orders"] if o["payment_status"] == "Paid"]
    pos_paid = [o for o in paid if o.get("channel", "POS") not in ECO_CHANNELS]
    eco_paid = [o for o in paid if o.get("channel") in ECO_CHANNELS]
    code = (store.get("gst_number") or "")[:2]
    place = f"{code}-{GST_STATES[code]}" if code in GST_STATES else ""

    pos_gst = _gst_by_rate(pos_paid)
    b2cs = [{"type": "OE", "place_of_supply": place, "rate": g["rate"], "taxable": g["taxable"],
             "cgst": g["cgst"], "sgst": g["sgst"], "cess": 0.0} for g in pos_gst]
    hsn = [{"hsn": RESTAURANT_SAC, "description": "Restaurant services", "uqc": "NA", "qty": g["qty"],
            "total_value": g["total_value"], "rate": g["rate"], "taxable": g["taxable"], "igst": 0.0,
            "cgst": g["cgst"], "sgst": g["sgst"], "cess": 0.0} for g in pos_gst]
    pos_taxable = round(sum(g["taxable"] for g in pos_gst), 2)
    pos_tax = round(sum(g["total_tax"] for g in pos_gst), 2)

    eco: Dict[str, Dict[str, Any]] = {}
    for o in eco_paid:
        r = eco.setdefault(o["channel"], {"operator": o["channel"], "orders": 0, "taxable": 0.0, "tax": 0.0, "total": 0.0})
        r["orders"] += 1
        r["taxable"] += o["subtotal"] - o.get("discount", 0)
        r["tax"] += o["tax"]
        r["total"] += o["total"]
    eco_rows = [{**r, "taxable": round(r["taxable"], 2), "tax": round(r["tax"], 2), "total": round(r["total"], 2)} for r in eco.values()]
    eco_taxable = round(sum(r["taxable"] for r in eco_rows), 2)

    pos_docs = sorted((o for o in orders if o.get("channel", "POS") not in ECO_CHANNELS), key=lambda o: o["order_number"])
    cancelled = sum(1 for o in pos_docs if o.get("order_status") == "Cancelled")
    docs = [{"nature": "Invoices for outward supply",
             "from": pos_docs[0]["order_number"] if pos_docs else "", "to": pos_docs[-1]["order_number"] if pos_docs else "",
             "total": len(pos_docs), "cancelled": cancelled, "net_issued": len(pos_docs) - cancelled}]

    daily: Dict[str, Dict[str, Any]] = {}
    for o in paid:
        day = (datetime.fromisoformat(o["created_at"]) - timedelta(minutes=tz_offset)).date().isoformat()
        r = daily.setdefault(day, {"date": day, "orders": 0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "total": 0.0})
        r["orders"] += 1
        r["taxable"] += o["subtotal"] - o.get("discount", 0)
        r["cgst"] += o["tax"] / 2
        r["sgst"] += o["tax"] / 2
        r["total"] += o["total"]
    daily_rows = [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()} for _, r in sorted(daily.items())]

    return {
        "month": month, "gstin": store.get("gst_number", ""), "place_of_supply": place,
        "summary": {
            "gross_sales": agg["summary"]["gross_sales"], "paid_orders": len(paid),
            "pos_taxable": pos_taxable, "pos_cgst": round(pos_tax / 2, 2), "pos_sgst": round(pos_tax / 2, 2),
            "pos_tax": pos_tax, "eco_taxable": eco_taxable,
            "eco_tax": round(sum(r["tax"] for r in eco_rows), 2),
            "cancelled_invoices": cancelled, "pending_orders": agg["summary"]["pending_orders"],
        },
        "gstr3b": [
            {"section": "3.1(a) Outward taxable supplies", "taxable": pos_taxable, "igst": 0.0,
             "cgst": round(pos_tax / 2, 2), "sgst": round(pos_tax / 2, 2), "cess": 0.0},
            {"section": "3.1.1(ii) Supplies via e-commerce operator u/s 9(5)", "taxable": eco_taxable, "igst": 0.0,
             "cgst": 0.0, "sgst": 0.0, "cess": 0.0},
        ],
        "b2cs": b2cs, "hsn": hsn, "docs": docs, "eco": eco_rows, "daily": daily_rows,
        "gst_breakdown": agg["gst_breakdown"],
    }


@api.get("/reports/monthly")
async def monthly_report(month: str, tz_offset: int = 0, current=Depends(get_current_store)):
    return await _build_monthly(current, month, tz_offset)


@api.get("/reports/monthly/csv")
async def monthly_report_csv(month: str, kind: Literal["full", "b2cs", "hsn", "docs"] = "full",
                             tz_offset: int = 0, current=Depends(get_current_store)):
    rep = await _build_monthly(current, month, tz_offset)
    buf = io.StringIO()
    w = csv.writer(buf)

    def b2cs_rows():
        w.writerow(["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"])
        for r in rep["b2cs"]:
            w.writerow([r["type"], r["place_of_supply"], "", r["rate"], r["taxable"], r["cess"], ""])

    def hsn_rows():
        w.writerow(["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value",
                    "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"])
        for r in rep["hsn"]:
            w.writerow([r["hsn"], r["description"], r["uqc"], r["qty"], r["total_value"], r["rate"], r["taxable"],
                        r["igst"], r["cgst"], r["sgst"], r["cess"]])

    def docs_rows():
        w.writerow(["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"])
        for r in rep["docs"]:
            w.writerow([r["nature"], r["from"], r["to"], r["total"], r["cancelled"]])

    if kind == "b2cs":
        b2cs_rows()
    elif kind == "hsn":
        hsn_rows()
    elif kind == "docs":
        docs_rows()
    else:
        s = rep["summary"]
        w.writerow(["Monthly GST Report", current.get("store_name", "")])
        w.writerow(["GSTIN", rep["gstin"]])
        w.writerow(["Return period", month])
        w.writerow(["Place of supply", rep["place_of_supply"]])
        w.writerow([])
        w.writerow(["SUMMARY"])
        for label, key in [("Gross sales (all channels)", "gross_sales"), ("Paid orders", "paid_orders"),
                           ("Taxable value - own supplies", "pos_taxable"), ("CGST payable", "pos_cgst"),
                           ("SGST payable", "pos_sgst"), ("Total GST payable", "pos_tax"),
                           ("Taxable value - via e-commerce operators u/s 9(5)", "eco_taxable"),
                           ("GST collected by e-commerce operators", "eco_tax"),
                           ("Cancelled invoices", "cancelled_invoices")]:
            w.writerow([label, s[key]])
        w.writerow([])
        w.writerow(["GSTR-3B"])
        w.writerow(["Section", "Taxable Value", "IGST", "CGST", "SGST", "Cess"])
        for r in rep["gstr3b"]:
            w.writerow([r["section"], r["taxable"], r["igst"], r["cgst"], r["sgst"], r["cess"]])
        w.writerow([])
        w.writerow(["GSTR-1 B2CS"])
        b2cs_rows()
        w.writerow([])
        w.writerow(["GSTR-1 HSN SUMMARY"])
        hsn_rows()
        w.writerow([])
        w.writerow(["GSTR-1 DOCUMENTS ISSUED"])
        docs_rows()
        w.writerow([])
        w.writerow(["E-COMMERCE OPERATOR SUPPLIES u/s 9(5)"])
        w.writerow(["Operator", "Orders", "Taxable Value", "GST (paid by operator)", "Total"])
        for r in rep["eco"]:
            w.writerow([r["operator"], r["orders"], r["taxable"], r["tax"], r["total"]])
        w.writerow([])
        w.writerow(["DAY-WISE SALES"])
        w.writerow(["Date", "Orders", "Taxable Value", "CGST", "SGST", "Total"])
        for r in rep["daily"]:
            w.writerow([r["date"], r["orders"], r["taxable"], r["cgst"], r["sgst"], r["total"]])
    name = f"gst-{kind}-{month}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


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
    existing = await db.stores.find_one({"username": "demo"}, {"_id": 0})
    if existing:
        await _ensure_tables(existing["id"])
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
        "Paneer Tikka": "https://images.pexels.com/photos/3928854/pexels-photo-3928854.png?auto=compress&w=400",
        "Chicken 65": "https://images.pexels.com/photos/35123974/pexels-photo-35123974.jpeg?auto=compress&w=400",
        "Veg Spring Roll": "https://images.unsplash.com/photo-1695712641569-05eee7b37b6d?w=400",
        "Chicken Biryani": "https://images.unsplash.com/photo-1727404679933-99daa2a7573a?w=400",
        "Paneer Butter Masala": "https://images.unsplash.com/photo-1712757248842-04f6e3844374?w=400",
        "Dal Makhani": "https://images.pexels.com/photos/30203314/pexels-photo-30203314.jpeg?auto=compress&w=400",
        "Mutton Rogan Josh": "https://images.pexels.com/photos/35123985/pexels-photo-35123985.jpeg?auto=compress&w=400",
        "Butter Naan": "https://images.unsplash.com/photo-1697155406014-04dc649b0953?w=400",
        "Garlic Naan": "https://images.pexels.com/photos/28674556/pexels-photo-28674556.jpeg?auto=compress&w=400",
        "Tandoori Roti": "https://images.pexels.com/photos/32965430/pexels-photo-32965430.jpeg?auto=compress&w=400",
        "Masala Chai": "https://images.pexels.com/photos/20270270/pexels-photo-20270270.jpeg?auto=compress&w=400",
        "Fresh Lime Soda": "https://images.pexels.com/photos/36268523/pexels-photo-36268523.jpeg?auto=compress&w=400",
        "Mango Lassi": "https://images.pexels.com/photos/14509267/pexels-photo-14509267.jpeg?auto=compress&w=400",
        "Gulab Jamun": "https://images.unsplash.com/photo-1666190092159-3171cf0fbb12?w=400",
        "Rasmalai": "https://images.pexels.com/photos/39973385/pexels-photo-39973385.jpeg?auto=compress&w=400",
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
            price=price, is_veg=is_veg, image_url=img.get(name, ""),
        )
        await db.menu_items.insert_one(it.model_dump())
    await _ensure_tables(store.id)
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
