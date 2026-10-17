import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { LayoutGrid, Plus, Users, Clock, Trash2, XCircle } from "lucide-react";
import PaymentModal from "./PaymentModal";

const STATUS = {
  Free: { card: "border-slate-800 hover:border-emerald-500/50", badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-400" },
  Occupied: { card: "border-amber-500/50 bg-amber-500/[0.04] hover:border-amber-400", badge: "bg-amber-500/10 text-amber-300 border-amber-500/40", dot: "bg-amber-400 pulse-dot" },
  Billed: { card: "border-rose-500/50 bg-rose-500/[0.04] hover:border-rose-400", badge: "bg-rose-500/10 text-rose-300 border-rose-500/40", dot: "bg-rose-400 pulse-dot" },
};

const minsSince = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

export default function TablesFloor() {
  const nav = useNavigate();
  const { subscribe } = useAuth();
  const [tables, setTables] = useState([]);
  const [payOrder, setPayOrder] = useState(null);
  const [newName, setNewName] = useState("");

  const load = async () => setTables((await api.get("/tables")).data);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useEffect(() => subscribe((m) => {
    if (["held_updated", "order_created", "payment_success", "order_updated"].includes(m.type)) load();
  }), [subscribe]);

  const open = (t) => {
    if (t.status === "Billed") return setPayOrder(t.pending_orders[0]);
    nav(`/pos?table=${encodeURIComponent(t.name)}`);
  };

  const addTable = async () => {
    if (!newName.trim()) return;
    try {
      await api.post("/tables", { name: newName.trim(), seats: 4 });
      setNewName(""); load(); toast.success("Table added");
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not add table"); }
  };

  const removeTable = async (e, t) => {
    e.stopPropagation();
    await api.delete(`/tables/${t.id}`); load();
  };

  const cancelBill = async (e, o) => {
    e.stopPropagation();
    await api.put(`/orders/${o.id}/status`, { order_status: "Cancelled" });
    toast(`Bill ${o.order_number} cancelled`); load();
  };

  const counts = tables.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {});
  const running = tables.reduce((s, t) => s + t.running_total, 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-indigo-400 font-semibold">Dine-In · Live</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><LayoutGrid className="h-6 w-6" /> Table Floor</h1>
        </div>
        <div className="flex items-center gap-5">
          {["Free", "Occupied", "Billed"].map((s) => (
            <div key={s} className="flex items-center gap-2 text-xs" data-testid={`floor-count-${s.toLowerCase()}`}>
              <span className={`h-2 w-2 rounded-full ${STATUS[s].dot}`} />
              <span className="uppercase tracking-wider text-slate-400 font-semibold">{s}</span>
              <span className="font-mono-pos text-slate-100 font-bold">{counts[s] || 0}</span>
            </div>
          ))}
          <div className="pl-5 border-l border-slate-800 text-right">
            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Running bills</div>
            <div className="font-mono-pos text-lg font-extrabold text-emerald-400" data-testid="floor-running-total">₹{running.toFixed(2)}</div>
          </div>
          <div className="flex gap-1.5">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTable()}
              placeholder="New table" data-testid="floor-new-table-input"
              className="w-28 h-9 bg-slate-900 border-slate-800 font-mono-pos" />
            <Button onClick={addTable} data-testid="floor-add-table-btn" className="h-9 bg-teal-600 hover:bg-teal-500"><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {tables.map((t) => {
            const st = STATUS[t.status];
            const lines = t.held_order?.items || t.pending_orders[0]?.items || [];
            return (
              <div key={t.id} role="button" tabIndex={0} onClick={() => open(t)} onKeyDown={(e) => e.key === "Enter" && open(t)}
                data-testid={`floor-table-${t.name}`}
                className={`group relative text-left bg-slate-900 border-2 rounded-xl p-4 min-h-[170px] flex flex-col cursor-pointer transition-[border-color,transform] hover:-translate-y-0.5 ${st.card}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-heading text-2xl font-extrabold text-white">{t.name}</div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5"><Users className="h-3 w-3" /> {t.seats} seats</div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${st.badge}`} data-testid={`floor-status-${t.name}`}>{t.status}</span>
                </div>
                <div className="flex-1 mt-3 text-[11px] text-slate-400 leading-snug line-clamp-3">
                  {t.status === "Free" ? <span className="text-slate-600">Tap to start a new bill</span> : lines.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                </div>
                {t.status !== "Free" && (
                  <div className="flex items-end justify-between pt-2 mt-2 border-t border-slate-800">
                    <span className="flex items-center gap-1 text-[11px] font-mono-pos text-slate-500"><Clock className="h-3 w-3" />{minsSince(t.since)}m</span>
                    <span className="font-mono-pos text-lg font-extrabold text-emerald-400" data-testid={`floor-bill-${t.name}`}>₹{t.running_total.toFixed(2)}</span>
                  </div>
                )}
                {t.status === "Billed" && (
                  <button onClick={(e) => cancelBill(e, t.pending_orders[0])} data-testid={`floor-cancel-bill-${t.name}`}
                    className="absolute bottom-[52px] right-3 text-[10px] text-slate-500 hover:text-rose-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <XCircle className="h-3 w-3" /> Cancel bill
                  </button>
                )}
                {t.status === "Free" && (
                  <button onClick={(e) => removeTable(e, t)} data-testid={`floor-delete-${t.name}`}
                    className="absolute bottom-3 right-3 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <PaymentModal order={payOrder} open={!!payOrder} onClose={() => setPayOrder(null)} onPaid={() => { setPayOrder(null); load(); }} />
    </div>
  );
}
