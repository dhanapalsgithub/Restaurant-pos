"""Multi-tenant Restaurant Billing POS - FastAPI Backend (Neon PostgreSQL Version)
Features: JWT per-store auth, menu/order CRUD, Inventory, Reports, Razorpay dynamic UPI QR,
UrbanPiper webhook routing via WebSockets, demo mode for payments.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Literal
from pathlib import Path
from datetime import datetime, timezone, timedelta
from fastapi.responses import Response
import os, logging, uuid, asyncio, hmac, hashlib, json, bcrypt, jwt, base64, io, csv
import asyncpg
from random import randint

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALG = os.environ.get("JWT_ALG", "HS256")
DEMO_MODE = os.environ.get("DEMO_PAYMENT_MODE", "true").lower() == "true"

db_pool: Optional[asyncpg.Pool] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool
    try:
        db_pool = await asyncpg.create_pool(DATABASE_URL, timeout=15.0)
        async with db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS stores (
                    id TEXT PRIMARY KEY,
                    store_name TEXT NOT NULL,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    address TEXT DEFAULT '',
                    phone TEXT DEFAULT '',
                    gst_number TEXT DEFAULT '',
                    urbanpiper_store_id TEXT DEFAULT '',
                    urbanpiper_api_key TEXT DEFAULT '',
                    razorpay_key_id TEXT DEFAULT '',
                    razorpay_key_secret TEXT DEFAULT '',
                    upi_vpa TEXT DEFAULT '',
                    business_type TEXT DEFAULT 'Restaurant',
                    aggregator_settings JSONB DEFAULT '{}'::jsonb,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS categories (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    sort_order INT DEFAULT 0,
                    icon TEXT DEFAULT 'utensils',
                    color TEXT DEFAULT 'teal'
                );
                CREATE TABLE IF NOT EXISTS menu_items (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    category_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    price REAL NOT NULL,
                    tax_rate REAL DEFAULT 5.0,
                    image_url TEXT DEFAULT '',
                    is_available BOOLEAN DEFAULT TRUE,
                    is_veg BOOLEAN DEFAULT TRUE,
                    track_stock BOOLEAN DEFAULT FALSE,
                    stock_qty REAL DEFAULT 0,
                    low_stock_threshold REAL DEFAULT 10,
                    modifiers JSONB DEFAULT '[]'::jsonb
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    order_number TEXT NOT NULL,
                    order_type TEXT NOT NULL,
                    channel TEXT DEFAULT 'POS',
                    items JSONB DEFAULT '[]'::jsonb,
                    subtotal REAL NOT NULL,
                    tax REAL NOT NULL,
                    discount REAL DEFAULT 0.0,
                    total REAL NOT NULL,
                    payment_mode TEXT DEFAULT 'Pending',
                    payment_status TEXT DEFAULT 'Pending',
                    payment_ref TEXT DEFAULT '',
                    gateway_order_id TEXT DEFAULT '',
                    gateway_payment_id TEXT DEFAULT '',
                    order_status TEXT DEFAULT 'Placed',
                    splits JSONB DEFAULT '[]'::jsonb,
                    platform_order_id TEXT DEFAULT '',
                    gross_order_amount REAL DEFAULT 0.0,
                    commission_base TEXT DEFAULT '',
                    commission_percent REAL DEFAULT 0.0,
                    commission_amount REAL DEFAULT 0.0,
                    gst_on_commission_percent REAL DEFAULT 0.0,
                    gst_on_commission REAL DEFAULT 0.0,
                    discount_borne_by_restaurant REAL DEFAULT 0.0,
                    tds_tcs_deduction REAL DEFAULT 0.0,
                    net_receivable_amount REAL DEFAULT 0.0,
                    table_no TEXT DEFAULT '',
                    customer_name TEXT DEFAULT '',
                    customer_phone TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    invoice_no TEXT DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS tables (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    seats INT DEFAULT 4,
                    sort_order INT DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS held_orders (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    order_type TEXT NOT NULL,
                    table_no TEXT DEFAULT '',
                    label TEXT DEFAULT '',
                    items JSONB DEFAULT '[]'::jsonb,
                    subtotal REAL NOT NULL,
                    tax REAL NOT NULL,
                    total REAL NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS payouts (
                    id TEXT PRIMARY KEY,
                    store_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    amount REAL NOT NULL,
                    order_ref TEXT DEFAULT '',
                    reference TEXT DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS counters (
                    id TEXT PRIMARY KEY,
                    seq INT DEFAULT 0
                );
            """)
        await seed_demo_store()
        print("✅ Connected to Neon PostgreSQL successfully!")
    except Exception as e:
        print(f"\n⚠️ Database Connection Error: {e}")
        db_pool = None

    yield
    
    if db_pool:
        await db_pool.close()

app = FastAPI(title="Multi-tenant Restaurant POS (Neon PostgreSQL)", lifespan=lifespan)
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
logger = logging.getLogger("pos")
logging.basicConfig(level=logging.INFO)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

# ====================== MODELS ======================
class LoginIn(BaseModel):
    username: str
    password: str

class OrderLine(BaseModel):
    item_id: str
    name: str
    qty: int = Field(ge=1, le=10000)
    price: float = Field(ge=0)
    tax_rate: float = Field(default=5.0, ge=0, le=100)
    notes: str = ""

class OrderIn(BaseModel):
    order_type: str
    items: List[OrderLine]
    table_no: Optional[str] = ""
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    notes: Optional[str] = ""
    discount: float = 0.0

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
    
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id, store_name, username, address, phone, gst_number, urbanpiper_store_id, urbanpiper_api_key, razorpay_key_id, razorpay_key_secret, upi_vpa, business_type, aggregator_settings, created_at FROM stores WHERE id = $1", payload["sub"])
        if not row:
            raise HTTPException(401, "Store not found")
        return dict(row)

async def seed_demo_store():
    async with db_pool.acquire() as conn:
        exists = await conn.fetchrow("SELECT id FROM stores WHERE username = 'demo'")
        if exists:
            sid = exists["id"]
            count = await conn.fetchval("SELECT count(*) FROM tables WHERE store_id = $1", sid)
            if count == 0:
                for i in range(1, 9):
                    await conn.execute("INSERT INTO tables (id, store_id, name, seats, sort_order) VALUES ($1, $2, $3, $4, $5)", str(uuid.uuid4()), sid, f"T{i}", 6 if i % 3 == 0 else 4, i)
            return

        sid = str(uuid.uuid4())
        pw_hash = hash_pw("demo123")
        now = now_iso()
        await conn.execute("""
            INSERT INTO stores (id, store_name, username, password_hash, address, phone, gst_number, urbanpiper_store_id, upi_vpa, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        """, sid, "Spice Garden Demo", "demo", pw_hash, "12 MG Road, Bengaluru", "+91 9876543210", "29ABCDE1234F1Z5", "UP-DEMO-001", "spicegarden@upi", now)

        for i in range(1, 9):
            await conn.execute("INSERT INTO tables (id, store_id, name, seats, sort_order) VALUES ($1, $2, $3, $4, $5)", str(uuid.uuid4()), sid, f"T{i}", 6 if i % 3 == 0 else 4, i)

        cats = [("Starters", 1), ("Main Course", 2), ("Breads", 3), ("Beverages", 4), ("Desserts", 5)]
        cat_map = {}
        for cname, sort_o in cats:
            cid = str(uuid.uuid4())
            await conn.execute("INSERT INTO categories (id, store_id, name, sort_order) VALUES ($1, $2, $3, $4)", cid, sid, cname, sort_o)
            cat_map[cname] = cid

        items = [
            ("Starters", "Paneer Tikka", 240, True),
            ("Starters", "Chicken 65", 280, False),
            ("Main Course", "Chicken Biryani", 320, False),
            ("Main Course", "Paneer Butter Masala", 290, True),
            ("Breads", "Butter Naan", 60, True),
            ("Beverages", "Masala Chai", 40, True),
            ("Desserts", "Gulab Jamun", 100, True),
        ]
        for cname, iname, price, is_veg in items:
            await conn.execute("""
                INSERT INTO menu_items (id, store_id, category_id, name, price, is_veg)
                VALUES ($1, $2, $3, $4, $5, $6)
            """, str(uuid.uuid4()), sid, cat_map[cname], iname, float(price), is_veg)

@api.get("/")
async def root():
    return {"message": "Restaurant POS API (Neon PostgreSQL)", "demo_mode": DEMO_MODE}

@api.post("/auth/login")
async def login(data: LoginIn):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM stores WHERE username = $1", data.username)
        if not row or not verify_pw(data.password, row["password_hash"]):
            raise HTTPException(401, "Invalid credentials")
        store = dict(row)
        store.pop("password_hash", None)
        token = create_token(store["id"], store["username"])
        return {"token": token, "store": store}

@api.get("/auth/me")
async def me(current=Depends(get_current_store)):
    return current

@api.get("/categories")
async def list_categories(current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, store_id, name, sort_order, icon, color FROM categories WHERE store_id = $1 ORDER BY sort_order ASC", current["id"])
        return [dict(r) for r in rows]

@api.post("/categories")
async def create_category(data: dict, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        cid = str(uuid.uuid4())
        name = data.get("name")
        sort_order = data.get("sort_order", 0)
        icon = data.get("icon", "utensils")
        color = data.get("color", "teal")
        if not name:
            raise HTTPException(400, "Category name is required")
        await conn.execute("INSERT INTO categories (id, store_id, name, sort_order, icon, color) VALUES ($1, $2, $3, $4, $5, $6)", cid, current["id"], name, sort_order, icon, color)
        return {"id": cid, "name": name, "icon": icon, "color": color}

@api.put("/categories/{cat_id}")
async def update_category(cat_id: str, data: dict, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM categories WHERE id = $1 AND store_id = $2", cat_id, current["id"])
        if not row:
            raise HTTPException(404, "Category not found")
        name = data.get("name")
        icon = data.get("icon", "utensils")
        color = data.get("color", "teal")
        sort_order = data.get("sort_order", 0)
        if not name:
            raise HTTPException(400, "Category name is required")
        await conn.execute("UPDATE categories SET name = $1, icon = $2, color = $3, sort_order = $4 WHERE id = $5 AND store_id = $6", name, icon, color, sort_order, cat_id, current["id"])
        return {"id": cat_id, "name": name, "icon": icon, "color": color, "sort_order": sort_order}

@api.delete("/categories/{cat_id}")
async def delete_category(cat_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM categories WHERE id = $1 AND store_id = $2", cat_id, current["id"])
        return {"deleted": True}

@api.post("/menu")
async def create_menu_item(data: dict, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        mid = str(uuid.uuid4())
        await conn.execute("""
            INSERT INTO menu_items (id, store_id, category_id, name, description, price, tax_rate, image_url, is_available, is_veg, track_stock, stock_qty, low_stock_threshold, modifiers)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        """, mid, current["id"], data["category_id"], data["name"], data.get("description", ""), float(data["price"]), float(data.get("tax_rate", 5.0)), data.get("image_url", ""), data.get("is_available", True), data.get("is_veg", True), data.get("track_stock", False), float(data.get("stock_qty", 0)), float(data.get("low_stock_threshold", 10)), json.dumps(data.get("modifiers", [])))
        return {"id": mid, **data}

@api.put("/menu/{item_id}")
async def update_menu_item(item_id: str, data: dict, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT id FROM menu_items WHERE id = $1 AND store_id = $2", item_id, current["id"])
        if not row:
            raise HTTPException(404, "Menu item not found")
        await conn.execute("""
            UPDATE menu_items SET category_id = $1, name = $2, description = $3, price = $4, tax_rate = $5, image_url = $6, is_available = $7, is_veg = $8, track_stock = $9, stock_qty = $10, low_stock_threshold = $11, modifiers = $12::jsonb
            WHERE id = $13 AND store_id = $14
        """, data["category_id"], data["name"], data.get("description", ""), float(data["price"]), float(data.get("tax_rate", 5.0)), data.get("image_url", ""), data.get("is_available", True), data.get("is_veg", True), data.get("track_stock", False), float(data.get("stock_qty", 0)), float(data.get("low_stock_threshold", 10)), json.dumps(data.get("modifiers", [])), item_id, current["id"])
        return {"id": item_id, **data}

@api.delete("/menu/{item_id}")
async def delete_menu_item(item_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        await conn.execute("DELETE FROM menu_items WHERE id = $1 AND store_id = $2", item_id, current["id"])
        return {"deleted": True}

@api.get("/menu")
async def list_menu(current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, store_id, category_id, name, description, price, tax_rate, image_url, is_available, is_veg, track_stock, stock_qty, low_stock_threshold, modifiers FROM menu_items WHERE store_id = $1", current["id"])
        res = []
        for r in rows:
            d = dict(r)
            if isinstance(d["modifiers"], str):
                d["modifiers"] = json.loads(d["modifiers"])
            res.append(d)
        return res

@api.get("/tables")
async def list_tables(current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT id, store_id, name, seats, sort_order FROM tables WHERE store_id = $1 ORDER BY sort_order ASC", current["id"])
        tables = []
        for r in rows:
            t = dict(r)
            t["status"] = "Free"
            t["running_total"] = 0.0
            t["held_order"] = None
            t["pending_orders"] = []
            tables.append(t)
        return tables

@api.get("/orders/{order_id}")
async def get_order_by_id(order_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        d = dict(row)
        for k in ("items", "splits"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return d

@api.post("/orders/{order_id}/pay/upi/initiate")
async def pay_upi_initiate(order_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        order = dict(row)
        vpa = current.get("upi_vpa") or "merchant@upi"
        amount = order["total"]
        ord_num = order["order_number"]
        upi_string = f"upi://pay?pa={vpa}&pn={current['store_name']}&am={amount}&tr={order_id}&tn=Order%20{ord_num}"
        await conn.execute("UPDATE orders SET payment_mode = 'UPI', payment_status = 'Pending' WHERE id = $1", order_id)
        return {"order_id": order_id, "gateway_order_id": f"pay_{uuid.uuid4().hex[:12]}", "upi_string": upi_string, "vpa": vpa, "amount": amount, "status": "Pending"}

@api.get("/orders/{order_id}/pay/upi/status")
async def pay_upi_status(order_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        order = dict(row)
        return {"order_id": order_id, "status": order["payment_status"], "payment_mode": order["payment_mode"]}

@api.post("/orders/{order_id}/pay/upi/simulate-success")
async def pay_upi_simulate_success(order_id: str, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        await conn.execute("UPDATE orders SET payment_mode = 'UPI', payment_status = 'Paid', order_status = 'Completed' WHERE id = $1", order_id)
        updated_row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        d = dict(updated_row)
        for k in ("items", "splits"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return {"status": "success", "payment_status": "Paid", "order": d}

@api.post("/orders/{order_id}/pay/cash")
async def pay_cash(order_id: str, request: Request, current=Depends(get_current_store)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        order_total = round(float(row["total"]), 2)
        tendered = round(float(body.get("amount_tendered", order_total)), 2)
        if tendered + 0.05 < order_total:
            raise HTTPException(400, "Tendered less than amount due")
        await conn.execute("UPDATE orders SET payment_mode = 'Cash', payment_status = 'Paid', order_status = 'Completed' WHERE id = $1", order_id)
        updated_row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        d = dict(updated_row)
        for k in ("items", "splits"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return {"status": "success", "order": d}

@api.post("/orders/{order_id}/pay/card")
async def pay_card(order_id: str, request: Request, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        await conn.execute("UPDATE orders SET payment_mode = 'Card', payment_status = 'Paid', order_status = 'Completed' WHERE id = $1", order_id)
        updated_row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        d = dict(updated_row)
        for k in ("items", "splits"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return {"status": "success", "order": d}

@api.post("/orders/{order_id}/split")
async def split_order(order_id: str, request: Request, current=Depends(get_current_store)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1 AND store_id = $2", order_id, current["id"])
        if not row:
            raise HTTPException(404, "Order not found")
        splits = body.get("splits", [])
        await conn.execute("UPDATE orders SET splits = $1::jsonb WHERE id = $2", json.dumps(splits), order_id)
        updated_row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
        d = dict(updated_row)
        for k in ("items", "splits"):
            if isinstance(d[k], str):
                d[k] = json.loads(d[k])
        return {"status": "success", "order": d}

@api.put("/stores/me")
async def update_store_profile(request: Request, current=Depends(get_current_store)):
    try:
        body = await request.json()
    except Exception:
        body = {}
    aggregator_settings_val = body.get("aggregator_settings")
    if aggregator_settings_val is not None and not isinstance(aggregator_settings_val, str):
        aggregator_settings_val = json.dumps(aggregator_settings_val)
    async with db_pool.acquire() as conn:
        await conn.execute("""
            UPDATE stores SET store_name = COALESCE($1, store_name), phone = COALESCE($2, phone), address = COALESCE($3, address), gst_number = COALESCE($4, gst_number), upi_vpa = COALESCE($5, upi_vpa), business_type = COALESCE($6, business_type), aggregator_settings = COALESCE($7::jsonb, aggregator_settings), urbanpiper_store_id = COALESCE($8, urbanpiper_store_id), urbanpiper_api_key = COALESCE($9, urbanpiper_api_key), razorpay_key_id = COALESCE($10, razorpay_key_id), razorpay_key_secret = COALESCE($11, razorpay_key_secret)
            WHERE id = $12
        """, body.get("store_name"), body.get("phone"), body.get("address"), body.get("gst_number"), body.get("upi_vpa"), body.get("business_type"), aggregator_settings_val, body.get("urbanpiper_store_id"), body.get("urbanpiper_api_key"), body.get("razorpay_key_id"), body.get("razorpay_key_secret"), current["id"])
        updated_store = await conn.fetchrow("SELECT * FROM stores WHERE id = $1", current["id"])
        return dict(updated_store)

@api.get("/held-orders")
async def list_held(current=Depends(get_current_store)):
    return []

@api.get("/inventory/low")
async def low_stock(current=Depends(get_current_store)):
    return []

@api.get("/orders")
async def list_orders(limit: int = 100, status_filter: Optional[str] = None, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE store_id = $1 ORDER BY created_at DESC LIMIT $2", current["id"], limit)
        orders = []
        for r in rows:
            d = dict(r)
            for k in ("items", "splits"):
                if isinstance(d[k], str):
                    d[k] = json.loads(d[k])
            orders.append(d)
        return orders

@api.post("/orders")
async def create_order(data: OrderIn, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        items = [i.model_dump() for i in data.items]
        subtotal = sum(i["price"] * i["qty"] for i in items)
        tax = subtotal * 0.05
        total = round(subtotal + tax - data.discount, 2)
        oid = str(uuid.uuid4())
        ord_num = f"ORD{randint(10000, 99999)}"
        now = now_iso()
        await conn.execute("""
            INSERT INTO orders (id, store_id, order_number, order_type, items, subtotal, tax, discount, total, table_no, customer_name, customer_phone, notes, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
        """, oid, current["id"], ord_num, data.order_type, json.dumps(items), subtotal, tax, data.discount, total, data.table_no or "", data.customer_name or "", data.customer_phone or "", data.notes or "", now)
        return {"id": oid, "order_number": ord_num, "total": total, "payment_status": "Pending"}

@api.get("/reports/daily")
async def daily_report(date: str, tz_offset: int = 0, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE store_id = $1 AND LEFT(created_at, 10) = $2 ORDER BY created_at DESC", current["id"], date)
        orders = []
        gross_sales = 0.0
        total_tax = 0.0
        discount_total = 0.0
        paid_count = 0
        pending_count = 0
        pending_amount = 0.0
        payment_modes_map = {}
        channels_map = {}
        items_map = {}
        gst_slab_map = {}

        for r in rows:
            d = dict(r)
            for k in ("items", "splits"):
                if isinstance(d[k], str):
                    d[k] = json.loads(d[k])
            orders.append(d)
            tax = float(d["tax"])
            disc = float(d.get("discount", 0.0))
            tot = float(d["total"])
            if d["payment_status"] == "Paid":
                paid_count += 1
                gross_sales += tot
            else:
                pending_count += 1
                pending_amount += tot
            total_tax += tax
            discount_total += disc

            pm = d.get("payment_mode", "Pending")
            if pm not in payment_modes_map:
                payment_modes_map[pm] = {"mode": pm, "count": 0, "amount": 0.0}
            payment_modes_map[pm]["count"] += 1
            payment_modes_map[pm]["amount"] += tot

            ch = d.get("channel", "POS")
            if ch not in channels_map:
                channels_map[ch] = {"channel": ch, "count": 0, "amount": 0.0}
            channels_map[ch]["count"] += 1
            channels_map[ch]["amount"] += tot

            for item in d["items"]:
                iname = item["name"]
                iqty = item["qty"]
                iprice = item["price"]
                itax_rate = float(item.get("tax_rate", 5.0))
                if iname not in items_map:
                    items_map[iname] = {"name": iname, "qty": 0, "amount": 0.0}
                items_map[iname]["qty"] += iqty
                items_map[iname]["amount"] += (iprice * iqty)

                item_total_val = iprice * iqty
                taxable_part = item_total_val / (1 + (itax_rate / 100.0))
                slab_tax = item_total_val - taxable_part
                if itax_rate not in gst_slab_map:
                    gst_slab_map[itax_rate] = {"rate": itax_rate, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "total_tax": 0.0}
                gst_slab_map[itax_rate]["taxable"] += taxable_part
                gst_slab_map[itax_rate]["cgst"] += slab_tax / 2
                gst_slab_map[itax_rate]["sgst"] += slab_tax / 2
                gst_slab_map[itax_rate]["total_tax"] += slab_tax

        taxable_value = gross_sales - total_tax
        avg_ticket = (gross_sales / paid_count) if paid_count > 0 else 0.0

        return {
            "date": date,
            "summary": {
                "gross_sales": round(gross_sales, 2),
                "taxable_value": round(max(0, taxable_value), 2),
                "total_tax": round(total_tax, 2),
                "cgst": round(total_tax / 2, 2),
                "sgst": round(total_tax / 2, 2),
                "discount": round(discount_total, 2),
                "paid_orders": paid_count,
                "pending_orders": pending_count,
                "pending_amount": round(pending_amount, 2),
                "avg_ticket": round(avg_ticket, 2),
                "items_sold": sum(i["qty"] for r in orders for i in r["items"]),
            },
            "gst_breakdown": list(gst_slab_map.values()),
            "payment_modes": list(payment_modes_map.values()),
            "channels": list(channels_map.values()),
            "top_items": sorted(list(items_map.values()), key=lambda x: x["qty"], reverse=True)[:5],
            "orders": orders
        }
@api.get("/reports/monthly")
async def monthly_report(month: str, tz_offset: int = 0, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE store_id = $1 AND LEFT(created_at, 7) = $2 ORDER BY created_at DESC", current["id"], month)
        
        gross_sales = 0.0
        pos_taxable = 0.0
        pos_cgst = 0.0
        pos_sgst = 0.0
        eco_taxable = 0.0
        paid_orders = 0
        
        gstr3b_map = {}
        b2cs_map = {}
        hsn_map = {}
        eco_map = {}
        daily_map = {}
        
        min_ord = None
        max_ord = None
        cancelled_count = 0
        total_issued = len(rows)

        for r in rows:
            d = dict(r)
            for k in ("items", "splits"):
                if isinstance(d[k], str):
                    try:
                        d[k] = json.loads(d[k])
                    except:
                        d[k] = []
            if not isinstance(d.get("items"), list):
                d["items"] = []
                
            tot = float(d.get("total", 0.0))
            tax = float(d.get("tax", 0.0))
            sub = float(d.get("subtotal", 0.0))
            ch = d.get("channel", "POS")
            p_stat = d.get("payment_status", "Pending")
            ord_num = d.get("order_number", "")
            c_date = d.get("created_at", "")[:10]
            
            if ord_num:
                if not min_ord: min_ord = ord_num
                max_ord = ord_num
                
            if p_stat == "Paid":
                paid_orders += 1
                gross_sales += tot
                if ch in ("Swiggy", "Zomato"):
                    eco_taxable += sub
                else:
                    pos_taxable += sub
                    pos_cgst += (tax / 2)
                    pos_sgst += (tax / 2)

            # Daily summary
            if c_date not in daily_map:
                daily_map[c_date] = {"date": c_date, "orders": 0, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "total": 0.0}
            daily_map[c_date]["orders"] += 1
            daily_map[c_date]["taxable"] += sub
            daily_map[c_date]["cgst"] += (tax / 2)
            daily_map[c_date]["sgst"] += (tax / 2)
            daily_map[c_date]["total"] += tot

            # ECO summary
            if ch in ("Swiggy", "Zomato"):
                if ch not in eco_map:
                    eco_map[ch] = {"operator": ch, "orders": 0, "taxable": 0.0, "tax": 0.0, "total": 0.0}
                eco_map[ch]["orders"] += 1
                eco_map[ch]["taxable"] += sub
                eco_map[ch]["tax"] += tax
                eco_map[ch]["total"] += tot

            # HSN / Items & B2CS breakdown
            for item in d["items"]:
                iprice = float(item.get("price", 0.0))
                iqty = int(item.get("qty", 1))
                itax = float(item.get("tax_rate", 5.0))
                iname = item.get("name", "Item")
                ival = iprice * iqty
                itaxable = ival / (1 + (itax / 100.0))
                itax_amt = ival - itaxable
                
                # B2CS
                b2_key = (ch, itax)
                if b2_key not in b2cs_map:
                    b2cs_map[b2_key] = {"type": "ECO" if ch in ("Swiggy","Zomato") else "OE", "place_of_supply": current.get("address", "Tamil Nadu"), "rate": itax, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0}
                b2cs_map[b2_key]["taxable"] += itaxable
                b2cs_map[b2_key]["cgst"] += (itax_amt / 2)
                b2cs_map[b2_key]["sgst"] += (itax_amt / 2)

                # HSN
                hsn_key = ("996331", itax)
                if hsn_key not in hsn_map:
                    hsn_map[hsn_key] = {"hsn": "996331", "description": "Restaurant Service", "uqc": "OTH", "qty": 0, "total_value": 0.0, "rate": itax, "taxable": 0.0, "igst": 0.0, "cgst": 0.0, "sgst": 0.0}
                hsn_map[hsn_key]["qty"] += iqty
                hsn_map[hsn_key]["total_value"] += ival
                hsn_map[hsn_key]["taxable"] += itaxable
                hsn_map[hsn_key]["cgst"] += (itax_amt / 2)
                hsn_map[hsn_key]["sgst"] += (itax_amt / 2)

        total_tax = pos_cgst + pos_sgst
        gstr3b_list = [{
            "section": "3.1 (a) Outward taxable supplies (other than zero rated)",
            "taxable": round(pos_taxable, 2),
            "igst": 0.0,
            "cgst": round(pos_cgst, 2),
            "sgst": round(pos_sgst, 2),
            "cess": 0.0
        }]

        docs_list = [{
            "nature": "Invoices for outward supply",
            "from": min_ord or "—",
            "to": max_ord or "—",
            "total": total_issued,
            "cancelled": cancelled_count,
            "net_issued": total_issued - cancelled_count
        }]

        return {
            "month": month,
            "gstin": current.get("gst_number", ""),
            "place_of_supply": current.get("address", "Tamil Nadu"),
            "summary": {
                "gross_sales": round(gross_sales, 2),
                "pos_taxable": round(pos_taxable, 2),
                "pos_cgst": round(pos_cgst, 2),
                "pos_sgst": round(pos_sgst, 2),
                "eco_taxable": round(eco_taxable, 2),
                "paid_orders": paid_orders
            },
            "gstr3b": gstr3b_list,
            "b2cs": list(b2cs_map.values()),
            "docs": docs_list,
            "hsn": list(hsn_map.values()),
            "eco": list(eco_map.values()),
            "daily": sorted(list(daily_map.values()), key=lambda x: x["date"], reverse=True)
        }
@api.get("/reports/reconciliation")
async def reconciliation_report(start: str, end: str, tz_offset: int = 0, current=Depends(get_current_store)):
    async with db_pool.acquire() as conn:
        # 1. Fetch orders in range for Swiggy/Zomato or all channels
        orders_rows = await conn.fetch(
            """
            SELECT * FROM orders 
            WHERE store_id = $1 AND LEFT(created_at, 10) >= $2 AND LEFT(created_at, 10) <= $3
            ORDER BY created_at DESC
            """,
            current["id"], start, end
        )
        
        # 2. Fetch payouts in range
        try:
            payouts_rows = await conn.fetch(
                """
                SELECT * FROM payouts 
                WHERE store_id = $1 AND date >= $2 AND date <= $3
                ORDER BY date DESC
                """,
                current["id"], start, end
            )
        except Exception:
            payouts_rows = []

        platforms_data = {
            "Swiggy": {"platform": "Swiggy", "orders": 0, "gross_order_amount": 0.0, "commission_amount": 0.0, "gst_on_commission": 0.0, "discount_borne_by_restaurant": 0.0, "tds_tcs_deduction": 0.0, "net_receivable_amount": 0.0, "actual_received": 0.0, "difference": 0.0},
            "Zomato": {"platform": "Zomato", "orders": 0, "gross_order_amount": 0.0, "commission_amount": 0.0, "gst_on_commission": 0.0, "discount_borne_by_restaurant": 0.0, "tds_tcs_deduction": 0.0, "net_receivable_amount": 0.0, "actual_received": 0.0, "difference": 0.0}
        }

        # Map payouts by order_ref or platform
        payouts_list = []
        platform_received = {"Swiggy": 0.0, "Zomato": 0.0}
        
        for p in payouts_rows:
            pd = dict(p)
            payouts_list.append(pd)
            plat = pd.get("platform", "Swiggy")
            amt = float(pd.get("amount", 0.0))
            if plat in platform_received:
                platform_received[plat] += amt

        orders_list = []
        for r in orders_rows:
            d = dict(r)
            for k in ("items", "splits"):
                if isinstance(d[k], str):
                    try:
                        d[k] = json.loads(d[k])
                    except:
                        d[k] = []
            if not isinstance(d.get("items"), list):
                d["items"] = []

            ch = d.get("channel", "POS")
            if ch not in ("Swiggy", "Zomato"):
                # Default aggregation or skip non-aggregator if only recon needed, but let's include or map to Swiggy/Zomato if applicable
                ch = "Swiggy" if "swiggy" in d.get("platform_order_id", "").lower() else "Swiggy"

            gross = float(d.get("gross_order_amount") or d.get("total", 0.0))
            comm = float(d.get("commission_amount", gross * 0.20)) # default 20% commission estimation if 0
            gst_comm = float(d.get("gst_on_commission", comm * 0.18))
            disc_rest = float(d.get("discount_borne_by_restaurant", 0.0))
            tds = float(d.get("tds_tcs_deduction", 0.0))
            net_rec = float(d.get("net_receivable_amount", gross - (comm + gst_comm + disc_rest + tds)))
            
            # Find matching payout if any
            received = None
            diff = None
            status = "Unsettled"
            
            if ch in platforms_data:
                platforms_data[ch]["orders"] += 1
                platforms_data[ch]["gross_order_amount"] += gross
                platforms_data[ch]["commission_amount"] += comm
                platforms_data[ch]["gst_on_commission"] += gst_comm
                platforms_data[ch]["discount_borne_by_restaurant"] += disc_rest
                platforms_data[ch]["tds_tcs_deduction"] += tds
                platforms_data[ch]["net_receivable_amount"] += net_rec

            orders_list.append({
                "id": d["id"],
                "order_number": d["order_number"],
                "platform": ch,
                "platform_order_id": d.get("platform_order_id", ""),
                "gross_order_amount": gross,
                "commission_amount": comm,
                "gst_on_commission": gst_comm,
                "discount_borne_by_restaurant": disc_rest,
                "tds_tcs_deduction": tds,
                "net_receivable_amount": net_rec,
                "received": received,
                "difference": diff,
                "status": status
            })

        for plat, data in platforms_data.items():
            data["actual_received"] = platform_received[plat]
            data["difference"] = data["actual_received"] - data["net_receivable_amount"]

        totals = {
            "orders": sum(p["orders"] for p in platforms_data.values()),
            "gross_order_amount": sum(p["gross_order_amount"] for p in platforms_data.values()),
            "commission_amount": sum(p["commission_amount"] for p in platforms_data.values()),
            "gst_on_commission": sum(p["gst_on_commission"] for p in platforms_data.values()),
            "discount_borne_by_restaurant": sum(p["discount_borne_by_restaurant"] for p in platforms_data.values()),
            "tds_tcs_deduction": sum(p["tds_tcs_deduction"] for p in platforms_data.values()),
            "net_receivable_amount": sum(p["net_receivable_amount"] for p in platforms_data.values()),
            "actual_received": sum(p["actual_received"] for p in platforms_data.values()),
            "difference": sum(p["difference"] for p in platforms_data.values()),
        }

        return {
            "start": start,
            "end": end,
            "platforms": list(platforms_data.values()),
            "totals": totals,
            "orders": orders_list,
            "payouts": payouts_list
        }

@api.get("/dashboard")
async def dashboard(current=Depends(get_current_store)):
    today_date = datetime.now(timezone.utc).isoformat()[:10]
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE store_id = $1 AND LEFT(created_at, 10) = $2 ORDER BY created_at DESC", current["id"], today_date)
        today_sales = 0.0
        today_orders = len(rows)
        channels = {"POS": 0, "Swiggy": 0, "Zomato": 0}
        payment_modes = {"Cash": 0, "Card": 0, "UPI": 0, "Online": 0, "Pending": 0}
        recent = []

        for r in rows:
            d = dict(r)
            for k in ("items", "splits"):
                if isinstance(d[k], str):
                    try:
                        d[k] = json.loads(d[k])
                    except:
                        d[k] = []
            tot = float(d["total"])
            if d["payment_status"] == "Paid":
                today_sales += tot
            ch = d.get("channel", "POS")
            if ch in channels:
                channels[ch] += 1
            else:
                channels["POS"] = channels.get("POS", 0) + 1
            pm = d.get("payment_mode", "Pending")
            if pm in payment_modes:
                payment_modes[pm] += 1
            else:
                payment_modes["Pending"] += 1
            if len(recent) < 5:
                recent.append(d)

        return {
            "today_sales": round(today_sales, 2),
            "today_orders": today_orders,
            "channels": channels,
            "payment_modes": payment_modes,
            "recent": recent if recent else [],
        }

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)