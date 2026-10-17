import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, Minus, Trash2, CreditCard, Utensils, ShoppingBag, PauseCircle, ListRestart } from "lucide-react";
import { toast } from "sonner";
import PaymentModal from "./PaymentModal";
import HeldOrdersDialog from "./HeldOrdersDialog";
import ReceiptPrint from "./ReceiptPrint";


export default function PosBilling() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [activeCat, setActiveCat] = useState("ALL");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]); // {id,name,price,qty,tax_rate}
  const [orderType, setOrderType] = useState("Dine-In");
  const [tableNo, setTableNo] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [heldId, setHeldId] = useState(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [tables, setTables] = useState([]);
  const [lastReceipt, setLastReceipt] = useState(() => JSON.parse(localStorage.getItem("pos_last_receipt") || "null"));
  const [params, setParams] = useSearchParams();
  const searchRef = useRef(null);
  const { store } = useAuth();

  const load = async () => {
    const [c, m, t, h] = await Promise.all([api.get("/categories"), api.get("/menu"), api.get("/tables"), api.get("/held-orders")]);
    setCategories(c.data); setItems(m.data); setTables(t.data); setHeldCount(h.data.length);
  };
  useEffect(() => { load(); }, []);

  const loadHeld = (h) => {
    setCart(h.items.map((i) => ({ id: i.item_id, name: i.name, price: i.price, qty: i.qty, tax_rate: i.tax_rate })));
    setOrderType(h.order_type); setTableNo(h.table_no || ""); setHeldId(h.id);
  };

  useEffect(() => {
    const t = params.get("table");
    if (!t) return;
    setOrderType("Dine-In"); setTableNo(t);
    api.get("/held-orders").then(({ data }) => {
      const h = data.find((x) => x.order_type === "Dine-In" && x.table_no === t);
      if (h) { loadHeld(h); toast(`Running bill for table ${t} loaded`); } else { setCart([]); setHeldId(null); }
    });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const refreshHeld = async () => setHeldCount((await api.get("/held-orders")).data.length);
  const lines = () => cart.map(({ id, name, qty, price, tax_rate }) => ({ item_id: id, name, qty, price, tax_rate }));

  const holdOrder = async () => {
    if (cart.length === 0) return toast.error("Cart is empty");
    const table = orderType === "Dine-In" ? tableNo : "";
    try {
      await api.post("/held-orders", { id: heldId, order_type: orderType, table_no: table, items: lines() });
    } catch (err) { return toast.error(err?.response?.data?.detail || "Could not hold order"); }
    toast.success(table ? `Bill parked on table ${table}` : "Order held");
    setCart([]); setTableNo(""); setHeldId(null);
    refreshHeld(); api.get("/tables").then(({ data }) => setTables(data));
  };

  const recall = (h) => {
    if (cart.length && heldId !== h.id) return toast.error("Hold or clear the current cart first");
    loadHeld(h); setHeldOpen(false);
    toast(`Recalled ${h.table_no ? "table " + h.table_no : "held order"}`);
  };

  const printLast = () => {
    if (!lastReceipt) return toast.error("No receipt to reprint");
    setTimeout(() => window.print(), 50);
  };

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (activeCat !== "ALL" && i.category_id !== activeCat) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, activeCat, search]);

  const addToCart = (item) => {
    if (!item.is_available) return toast.error(`${item.name} is OUT OF STOCK`);
    setCart((c) => {
      const ex = c.find((x) => x.id === item.id);
      if (ex) return c.map((x) => x.id === item.id ? { ...x, qty: x.qty + 1 } : x);
      return [...c, { id: item.id, name: item.name, price: item.price, qty: 1, tax_rate: item.tax_rate }];
    });
  };
  const inc = (id) => setCart((c) => c.map((x) => x.id === id ? { ...x, qty: x.qty + 1 } : x));
  const dec = (id) => setCart((c) => c.map((x) => x.id === id ? { ...x, qty: Math.max(1, x.qty - 1) } : x));
  const rm = (id) => setCart((c) => c.filter((x) => x.id !== id));

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = cart.reduce((s, i) => s + i.price * i.qty * (i.tax_rate / 100), 0);
  const total = +(subtotal + tax).toFixed(2);
  const rates = [...new Set(cart.map((i) => i.tax_rate))];
  const gstLabel = rates.length === 1 ? `GST (${rates[0]}%)` : "GST";

  const checkout = async () => {
    if (cart.length === 0) return toast.error("Cart is empty");
    if (currentOrder?.payment_status === "Pending") return setPayOpen(true);
    const payload = { order_type: orderType, items: lines(), table_no: orderType === "Dine-In" ? tableNo : "" };
    const { data } = await api.post("/orders", payload);
    if (heldId) { await api.delete(`/held-orders/${heldId}`); setHeldId(null); refreshHeld(); }
    setCurrentOrder(data); setPayOpen(true);
  };

  useEffect(() => { setCurrentOrder(null); }, [cart, orderType, tableNo]);

  const onPaid = (o) => {
    setCart([]); setTableNo(""); setCurrentOrder(null); setHeldId(null);
    if (o) { setLastReceipt(o); localStorage.setItem("pos_last_receipt", JSON.stringify(o)); }
  };

  useEffect(() => {
    const h = (e) => {
      if (payOpen || heldOpen) return;
      if (e.key === "F2") { e.preventDefault(); checkout(); }
      else if (e.key === "F4") { e.preventDefault(); holdOrder(); }
      else if (e.key === "F8") { e.preventDefault(); printLast(); }
      else if (e.key === "F3" || ((e.ctrlKey || e.metaKey) && e.key === "/")) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "Escape" && document.activeElement === searchRef.current) { setSearch(""); searchRef.current.blur(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="h-full flex overflow-hidden">
      {/* Menu grid */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search + categories */}
        <div className="p-3 border-b border-slate-800 bg-slate-950 space-y-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3.5 text-slate-500" />
            <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search menu...  [F3 / Ctrl + /]" data-testid="pos-search-input"
              className="pl-10 h-11 bg-slate-900 border-slate-800 text-slate-100 font-mono-pos" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button onClick={() => setActiveCat("ALL")} data-testid="pos-cat-ALL"
              className={`shrink-0 px-3 h-8 rounded text-xs font-semibold uppercase tracking-wider transition
                ${activeCat === "ALL" ? "bg-teal-500 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"}`}>All</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setActiveCat(c.id)} data-testid={`pos-cat-${c.id}`}
                className={`shrink-0 px-3 h-8 rounded text-xs font-semibold uppercase tracking-wider transition
                  ${activeCat === c.id ? "bg-teal-500 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"}`}>
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto p-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((it) => (
              <button key={it.id} onClick={() => addToCart(it)} data-testid={`pos-item-${it.id}`}
                className={`relative text-left bg-slate-900 border border-slate-800 rounded-lg p-3 hover:border-teal-500/60 hover:-translate-y-0.5 transition
                  ${!it.is_available ? "opacity-50" : ""}`}>
                {it.image_url && (
                  <div className="h-24 w-full rounded bg-slate-800 overflow-hidden mb-2">
                    <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm border mt-1 ${it.is_veg ? "border-emerald-500 bg-emerald-500/20" : "border-rose-500 bg-rose-500/20"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-100 leading-tight truncate">{it.name}</div>
                    <div className="font-mono-pos text-emerald-400 font-bold text-sm mt-1">₹{it.price.toFixed(2)}</div>
                  </div>
                </div>
                {!it.is_available && (
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 rounded-lg">
                    <span className="text-rose-400 text-xs font-bold uppercase tracking-widest">Out of stock</span>
                  </div>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-slate-500 py-12">No items found</div>
            )}
          </div>
        </div>
      </div>

      {/* Cart */}
      <aside className="w-[420px] bg-slate-900 border-l border-slate-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-slate-800">
          <div className="flex gap-1.5 mb-2">
            {["Dine-In", "Takeaway"].map((t) => (
              <button key={t} onClick={() => setOrderType(t)} data-testid={`order-type-${t}`}
                className={`flex-1 h-9 rounded text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-2 border transition
                  ${orderType === t ? (t === "Dine-In" ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300" : "bg-amber-500/15 border-amber-500/40 text-amber-300")
                    : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"}`}>
                {t === "Dine-In" ? <Utensils className="h-3.5 w-3.5" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {orderType === "Dine-In" && (
              <select value={tableNo} onChange={(e) => setTableNo(e.target.value)} data-testid="order-table-select"
                className="flex-1 h-9 rounded-md bg-slate-950 border border-slate-800 text-slate-100 font-mono-pos text-sm px-2 focus:outline-none focus:border-teal-500">
                <option value="" className="bg-slate-900">No table</option>
                {tables.map((t) => <option key={t.id} value={t.name} className="bg-slate-900">{t.name} · {t.status}</option>)}
              </select>
            )}
            <button onClick={() => setHeldOpen(true)} data-testid="held-orders-open-btn"
              className={`h-9 px-3 rounded-md border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${orderType === "Dine-In" ? "" : "flex-1 justify-center"} border-slate-800 bg-slate-950 text-slate-300 hover:border-amber-500/50 hover:text-amber-300`}>
              <ListRestart className="h-3.5 w-3.5" /> Held
              <span className="font-mono-pos bg-amber-500/15 text-amber-300 px-1.5 rounded" data-testid="held-count">{heldCount}</span>
            </button>
          </div>
          {heldId && (
            <div className="text-[10px] text-amber-400 mt-1.5 uppercase tracking-wider font-semibold" data-testid="recalled-indicator">
              Recalled held bill · F4 to re-park
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-2">
          {cart.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-10">Cart is empty<br /><span className="text-xs">Tap items to add</span></div>
          )}
          {cart.map((i) => (
            <div key={i.id} className="bg-slate-950 border border-slate-800 rounded-md p-2.5" data-testid={`cart-item-${i.id}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium text-sm text-slate-100 flex-1 leading-tight">{i.name}</div>
                <button onClick={() => rm(i.id)} data-testid={`cart-remove-${i.id}`} className="text-slate-500 hover:text-rose-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => dec(i.id)} data-testid={`cart-dec-${i.id}`} className="h-7 w-7 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-200"><Minus className="h-3 w-3" /></button>
                  <span className="font-mono-pos text-sm text-slate-100 min-w-[20px] text-center">{i.qty}</span>
                  <button onClick={() => inc(i.id)} data-testid={`cart-inc-${i.id}`} className="h-7 w-7 rounded bg-teal-600 hover:bg-teal-500 flex items-center justify-center text-white"><Plus className="h-3 w-3" /></button>
                </div>
                <div className="font-mono-pos text-emerald-400 font-bold">₹{(i.price * i.qty).toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-slate-800 space-y-1.5">
          <div className="flex justify-between text-xs text-slate-400"><span>Subtotal</span><span className="font-mono-pos">₹{subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between text-xs text-slate-400"><span>{gstLabel}</span><span className="font-mono-pos">₹{tax.toFixed(2)}</span></div>
          <div className="flex justify-between items-end pt-2 border-t border-slate-800">
            <span className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold">Total</span>
            <span className="font-mono-pos text-3xl font-extrabold text-teal-400" data-testid="cart-total">₹{total.toFixed(2)}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <Button onClick={holdOrder} variant="outline" data-testid="pos-hold-btn"
              className="h-12 px-4 border-amber-500/40 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15 hover:text-amber-200 font-bold tracking-wide">
              <PauseCircle className="h-4 w-4 mr-1.5" /> HOLD
            </Button>
            <Button onClick={checkout} data-testid="pos-checkout-btn"
              className="flex-1 h-12 bg-teal-600 hover:bg-teal-500 font-bold tracking-wide">
              <CreditCard className="h-4 w-4 mr-2" /> CHARGE ₹{total.toFixed(2)}
            </Button>
          </div>
          <div className="flex justify-between pt-1.5 text-[10px] font-mono-pos text-slate-500 uppercase tracking-wider" data-testid="shortcut-hints">
            {[["F2", "Pay"], ["F4", "Hold"], ["F8", "Reprint"], ["F3", "Search"]].map(([k, l]) => (
              <span key={k}><kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">{k}</kbd> {l}</span>
            ))}
          </div>
        </div>
      </aside>

      <PaymentModal order={currentOrder} open={payOpen} onClose={() => setPayOpen(false)} onPaid={onPaid} />
      <HeldOrdersDialog open={heldOpen} onClose={() => setHeldOpen(false)} onRecall={recall} onChanged={setHeldCount} />
      {!payOpen && lastReceipt && <ReceiptPrint order={lastReceipt} store={store} />}
    </div>
  );
}
