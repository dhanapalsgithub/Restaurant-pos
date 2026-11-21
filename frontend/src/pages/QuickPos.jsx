import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Banknote, QrCode, Minus, Plus, Trash2, SlidersHorizontal, AlertTriangle, MoreHorizontal, Zap } from "lucide-react";
import { iconFor, colorFor, defaultChoice, lineFromChoice } from "@/lib/quickMenu";
import { getPrinterSettings, printOrder } from "@/lib/printer";
import ModifierPicker from "./ModifierPicker";
import PaymentModal from "./PaymentModal";
import ReceiptPrint from "./ReceiptPrint";

const MULTS = [1, 2, 3, 5, 10];
const localDate = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

function TodayStrip({ day, low }) {
  const mode = (m) => day?.payment_modes.find((x) => x.mode === m)?.amount || 0;
  const cells = [["Cash", mode("Cash"), "text-emerald-400", "today-cash"], ["UPI", mode("UPI"), "text-teal-300", "today-upi"],
    ["Bills", day?.summary.paid_orders ?? 0, "text-slate-100", "today-bills"], ["Items sold", day?.summary.items_sold ?? 0, "text-slate-100", "today-items"]];
  return (
    <div className="flex items-center gap-5">
      {cells.map(([l, v, c, t]) => (
        <div key={l} className="text-right" data-testid={t}>
          <div className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold">{l}</div>
          <div className={`font-mono-pos text-sm font-bold ${c}`}>{typeof v === "number" && l !== "Bills" && l !== "Items sold" ? `₹${v.toFixed(0)}` : v}</div>
        </div>
      ))}
      {low > 0 && (
        <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/40 rounded px-2 py-1" data-testid="low-stock-badge">
          <AlertTriangle className="h-3.5 w-3.5" /> {low} low stock
        </span>
      )}
    </div>
  );
}

function ItemCard({ it, color, onTap, onOptions }) {
  const c = colorFor(color);
  const low = it.track_stock && it.stock_qty <= it.low_stock_threshold;
  return (
    <div role="button" tabIndex={0} onClick={() => onTap(it)} data-testid={`quick-item-${it.id}`}
      className={`relative select-none rounded-2xl border-2 p-4 h-32 flex flex-col justify-between cursor-pointer active:scale-[0.97] transition-[transform,border-color] ${c.card} ${!it.is_available ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="font-heading text-lg font-bold leading-tight text-white pr-8">{it.name}</div>
      <div className="flex items-end justify-between">
        <span className={`font-mono-pos text-2xl font-extrabold ${c.text}`}>₹{it.price}</span>
        {it.track_stock && (
          <span className={`text-[10px] font-bold font-mono-pos px-1.5 py-0.5 rounded ${low ? "bg-rose-500/20 text-rose-300" : "bg-slate-900/70 text-slate-400"}`}>
            {it.is_available ? `${it.stock_qty} left` : "SOLD OUT"}
          </span>
        )}
      </div>
      {it.modifiers?.length > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onOptions(it); }} data-testid={`quick-options-${it.id}`}
          className="absolute top-2.5 right-2.5 h-9 w-9 rounded-lg bg-slate-950/60 border border-slate-700 flex items-center justify-center text-slate-300 hover:text-white">
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default function QuickPos() {
  const { store, subscribe } = useAuth();
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState("ALL");
  const [cart, setCart] = useState([]);
  const [sel, setSel] = useState(null);
  const [mult, setMult] = useState(1);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(false);
  const [upiOrder, setUpiOrder] = useState(null);
  const [day, setDay] = useState(null);
  const [low, setLow] = useState(0);
  const [receipt, setReceipt] = useState(null);
  const paidRef = React.useRef(new Set());

  const loadMenu = useCallback(async () => {
    const [c, m, l] = await Promise.all([api.get("/categories"), api.get("/menu"), api.get("/inventory/low")]);
    setCats(c.data); setItems(m.data); setLow(l.data.length);
  }, []);
  const loadDay = useCallback(async () => {
    const { data } = await api.get("/reports/daily", { params: { date: localDate(), tz_offset: new Date().getTimezoneOffset() } });
    setDay(data);
  }, []);
  useEffect(() => { loadMenu(); loadDay(); }, [loadMenu, loadDay]);
  useEffect(() => subscribe((m) => {
    if (m.type === "stock_updated") loadMenu();
    if (m.type === "payment_success") loadDay();
  }), [subscribe, loadMenu, loadDay]);

  const catColor = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.color])), [cats]);
  const shown = items.filter((i) => active === "ALL" || i.category_id === active);

  const addLine = (item, choice) => {
    const ln = lineFromChoice(item, choice, mult);
    setCart((c) => {
      const ex = c.find((x) => x.key === ln.key);
      return ex ? c.map((x) => (x.key === ln.key ? { ...x, qty: x.qty + mult } : x)) : [...c, ln];
    });
    setSel(ln.key); setMult(1);
  };
  const tap = (it) => addLine(it, defaultChoice(it));
  const bump = (key, by) => setCart((c) => c.flatMap((x) => (x.key !== key ? [x] : x.qty + by <= 0 ? [] : [{ ...x, qty: x.qty + by }])));

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = cart.reduce((s, i) => s + i.price * i.qty * (i.tax_rate / 100), 0);
  const total = Math.round((subtotal + tax) * 100) / 100;

  const createOrder = async () => {
    const { data } = await api.post("/orders", {
      order_type: "Takeaway",
      items: cart.map((i) => ({ item_id: i.id, name: i.name, qty: i.qty, price: i.price, tax_rate: i.tax_rate, notes: i.notes })),
    });
    return data;
  };
  const done = async (order) => {
    setCart([]); setSel(null); loadDay(); loadMenu();
    if (getPrinterSettings().autoPrint) {
      setReceipt(order);
      await new Promise((r) => setTimeout(r, 30));
      const how = await printOrder(order, store, { kot: false });
      if (how !== "dialog") toast.success(`Printed ${order.order_number}`);
    }
  };

  const payCash = async () => {
    if (!cart.length || busy) return cart.length ? null : toast.error("Tap items to start a bill");
    setBusy(true);
    try {
      const o = await createOrder();
      await api.post(`/orders/${o.id}/pay/cash`, { tendered: o.total });
      const { data } = await api.get(`/orders/${o.id}`);
      toast.success(`${data.order_number} · Cash ₹${data.total.toFixed(2)}`);
      await done(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Billing failed"); }
    finally { setBusy(false); }
  };
  const payUpi = async (more = false) => {
    if (!cart.length || busy) return cart.length ? null : toast.error("Tap items to start a bill");
    setBusy(true);
    try { setUpiOrder({ order: await createOrder(), more }); }
    catch (e) { toast.error(e?.response?.data?.detail || "Billing failed"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const h = (e) => {
      if (upiOrder || picker) return;
      if (e.key === "F2") { e.preventDefault(); payCash(); }
      else if (e.key === "F3") { e.preventDefault(); payUpi(); }
      else if (e.key === "Escape") { setCart([]); setSel(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  return (
    <div className="h-full flex overflow-hidden" data-testid="quick-pos">
      <nav className="w-28 bg-slate-900 border-r border-slate-800 overflow-y-auto p-2 space-y-2 shrink-0">
        {[{ id: "ALL", name: "All items", icon: "utensils", color: "teal" }, ...cats].map((c) => {
          const Icon = iconFor(c.icon); const col = colorFor(c.color); const on = active === c.id;
          return (
            <button key={c.id} onClick={() => setActive(c.id)} data-testid={`quick-cat-${c.id}`}
              className={`w-full rounded-xl border-2 p-2.5 flex flex-col items-center gap-1.5 text-center transition-colors ${on ? `${col.chip}` : "border-transparent text-slate-400 hover:bg-slate-800"}`}>
              <Icon className={`h-7 w-7 ${on ? "" : col.text}`} />
              <span className="text-[10px] font-semibold leading-tight line-clamp-2">{c.name}</span>
            </button>
          );
        })}
      </nav>

      <section className="flex-1 flex flex-col overflow-hidden">
        <div className="h-14 px-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mr-2">Qty</span>
            {MULTS.map((m) => (
              <button key={m} onClick={() => setMult(m)} data-testid={`quick-mult-${m}`}
                className={`h-9 min-w-[44px] px-2 rounded-lg font-mono-pos font-bold text-sm border-2 transition-colors ${mult === m ? "border-amber-400 bg-amber-500/15 text-amber-200" : "border-slate-800 text-slate-400 hover:text-slate-200"}`}>
                ×{m}
              </button>
            ))}
          </div>
          <TodayStrip day={day} low={low} />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 && <div className="text-center text-slate-500 py-16">No items yet. Add the quick counter pack from Menu &amp; Stock.</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {shown.map((it) => <ItemCard key={it.id} it={it} color={catColor[it.category_id]} onTap={tap} onOptions={setPicker} />)}
          </div>
        </div>
      </section>

      <aside className="w-[380px] bg-slate-900 border-l border-slate-800 flex flex-col shrink-0">
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {cart.length === 0 && <div className="text-center text-slate-500 text-sm py-16">Tap an item to bill<br /><span className="text-xs">F2 Cash · F3 UPI · Esc clear</span></div>}
          {cart.map((i) => (
            <button key={i.key} onClick={() => setSel(i.key)} data-testid={`quick-line-${i.id}`}
              className={`w-full text-left rounded-lg border px-3 py-2 flex items-center gap-2 transition-colors ${sel === i.key ? "border-teal-500/60 bg-teal-500/10" : "border-slate-800 bg-slate-950"}`}>
              <span className="font-mono-pos font-bold text-amber-300 w-8">{i.qty}×</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-slate-100 truncate">{i.name}</span>
                {i.notes && <span className="block text-[11px] text-slate-500 truncate">{i.notes}</span>}
              </span>
              <span className="font-mono-pos font-bold text-emerald-400">₹{(i.price * i.qty).toFixed(0)}</span>
            </button>
          ))}
        </div>
        {sel && cart.some((x) => x.key === sel) && (
          <div className="px-3 pb-2 grid grid-cols-5 gap-1.5" data-testid="quick-qty-pad">
            <button onClick={() => bump(sel, -1)} data-testid="quick-qty-minus" className="h-11 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center"><Minus className="h-4 w-4" /></button>
            {[1, 2, 5].map((n) => (
              <button key={n} onClick={() => bump(sel, n)} data-testid={`quick-qty-plus-${n}`}
                className="h-11 rounded-lg bg-teal-600/80 hover:bg-teal-500 font-mono-pos font-bold flex items-center justify-center gap-0.5"><Plus className="h-3.5 w-3.5" />{n}</button>
            ))}
            <button onClick={() => bump(sel, -9999)} data-testid="quick-qty-remove" className="h-11 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 flex items-center justify-center"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
        <div className="p-3 border-t border-slate-800 space-y-2">
          <div className="flex items-end justify-between">
            <span className="text-xs text-slate-400">{cart.reduce((s, i) => s + i.qty, 0)} items · GST ₹{tax.toFixed(2)}</span>
            <span className="font-mono-pos text-4xl font-extrabold text-teal-300" data-testid="quick-total">₹{total.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={payCash} disabled={busy} data-testid="quick-pay-cash"
              className="h-20 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 flex flex-col items-center justify-center">
              <Banknote className="h-6 w-6" /><span className="font-bold tracking-wide">CASH</span>
            </button>
            <button onClick={() => payUpi()} disabled={busy} data-testid="quick-pay-upi"
              className="h-20 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 flex flex-col items-center justify-center">
              <QrCode className="h-6 w-6" /><span className="font-bold tracking-wide">UPI QR</span>
            </button>
          </div>
          <button onClick={() => payUpi(true)} disabled={busy} data-testid="quick-pay-more"
            className="w-full h-9 rounded-lg border border-slate-700 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5">
            <MoreHorizontal className="h-4 w-4" /> Card / tendered cash / split
          </button>
        </div>
      </aside>

      <ModifierPicker item={picker} qty={mult} onClose={() => setPicker(null)} onAdd={(ch) => { addLine(picker, ch); setPicker(null); }} />
      <PaymentModal order={upiOrder?.order} open={!!upiOrder} autoUpi={!upiOrder?.more} autoFinish
        onClose={() => {
          const o = upiOrder?.order;
          setUpiOrder(null);
          if (o && !paidRef.current.has(o.id)) api.put(`/orders/${o.id}/status`, { order_status: "Cancelled" }).then(loadMenu).catch(() => {});
        }}
        onPaid={(o) => { paidRef.current.add(o.id); setUpiOrder(null); done(o); }} />
      {!upiOrder && receipt && <ReceiptPrint order={receipt} store={store} showKot={false} />}
    </div>
  );
}
