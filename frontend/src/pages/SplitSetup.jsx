import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Minus, Plus, Users, ListChecks, Divide } from "lucide-react";

export const GUEST_STYLES = [
  "bg-teal-500/15 text-teal-300 border-teal-500/50",
  "bg-indigo-500/15 text-indigo-300 border-indigo-500/50",
  "bg-amber-500/15 text-amber-300 border-amber-500/50",
  "bg-rose-500/15 text-rose-300 border-rose-500/50",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/50",
  "bg-sky-500/15 text-sky-300 border-sky-500/50",
];
const guestStyle = (i) => GUEST_STYLES[i % GUEST_STYLES.length];

const equalSplit = (total, n) => {
  const p = Math.round(total * 100);
  const each = Math.floor(p / n);
  const rem = p - each * n;
  return Array.from({ length: n }, (_, i) => (each + (i < rem ? 1 : 0)) / 100);
};

const Stepper = ({ value, min, max, onChange }) => (
  <div className="flex items-center gap-2">
    <button onClick={() => onChange(Math.max(min, value - 1))} data-testid="split-guests-dec"
      className="h-9 w-9 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center"><Minus className="h-3.5 w-3.5" /></button>
    <span className="font-mono-pos text-xl font-bold w-8 text-center" data-testid="split-guests-count">{value}</span>
    <button onClick={() => onChange(Math.min(max, value + 1))} data-testid="split-guests-inc"
      className="h-9 w-9 rounded bg-teal-600 hover:bg-teal-500 flex items-center justify-center"><Plus className="h-3.5 w-3.5" /></button>
  </div>
);

export default function SplitSetup({ order, onCreated, onCancel }) {
  const [mode, setMode] = useState("equal");
  const [parts, setParts] = useState(2);
  const [assign, setAssign] = useState({});
  const [busy, setBusy] = useState(false);
  const maxGuests = mode === "equal" ? 10 : 6;
  const n = Math.min(parts, maxGuests);

  const units = useMemo(() => order.items.flatMap((ln, index) =>
    Array.from({ length: ln.qty }, (_, u) => ({ key: `${index}-${u}`, index, name: ln.name, price: ln.price, rate: ln.tax_rate ?? 5 }))), [order]);
  const guestOf = (u) => Math.min(assign[u.key] ?? 0, n - 1);

  const preview = useMemo(() => {
    if (mode === "equal") return equalSplit(order.total, n);
    const ratio = order.subtotal ? (order.subtotal - (order.discount || 0)) / order.subtotal : 1;
    const arr = Array(n).fill(0);
    units.forEach((u) => { arr[guestOf(u)] += u.price * (1 + u.rate / 100) * ratio; });
    const rounded = arr.map((a) => Math.round(a * 100) / 100);
    rounded[n - 1] = Math.round((order.total - rounded.slice(0, -1).reduce((s, a) => s + a, 0)) * 100) / 100;
    return rounded;
  }, [mode, n, units, assign, order]);

  const counts = Array.from({ length: n }, (_, g) => units.filter((u) => guestOf(u) === g).length);
  const emptyGuest = mode === "items" && counts.some((c) => c === 0);

  const create = async () => {
    const groups = Array.from({ length: n }, (_, g) => {
      const byIdx = {};
      units.filter((u) => guestOf(u) === g).forEach((u) => { byIdx[u.index] = (byIdx[u.index] || 0) + 1; });
      return Object.entries(byIdx).map(([index, qty]) => ({ index: Number(index), qty }));
    });
    setBusy(true);
    try {
      const { data } = await api.post(`/orders/${order.id}/split`, { mode, parts: n, groups: mode === "items" ? groups : [] });
      onCreated(data);
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not split bill"); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-6" data-testid="split-setup">
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1.5">
          {[["equal", "Split equally", Divide], ["items", "By item", ListChecks]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setMode(k)} data-testid={`split-mode-${k}`}
              className={`h-9 px-3 rounded-md border text-xs font-semibold uppercase tracking-wider flex items-center gap-2 transition-colors ${mode === k
                ? "bg-teal-500/15 border-teal-500/50 text-teal-300" : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Guests</span>
          <Stepper value={n} min={2} max={maxGuests} onChange={setParts} />
        </div>
      </div>

      {mode === "items" && (
        <div className="max-h-56 overflow-auto rounded-lg border border-slate-800 divide-y divide-slate-800 mb-4" data-testid="split-item-list">
          {units.map((u) => (
            <div key={u.key} className="flex items-center gap-3 px-3 py-2 bg-slate-950">
              <span className="flex-1 text-sm text-slate-200 truncate">{u.name}</span>
              <span className="font-mono-pos text-xs text-slate-500 w-16 text-right">₹{u.price.toFixed(2)}</span>
              <div className="flex gap-1">
                {Array.from({ length: n }, (_, g) => (
                  <button key={g} onClick={() => setAssign((a) => ({ ...a, [u.key]: g }))} data-testid={`split-assign-${u.key}-${g}`}
                    className={`h-7 w-8 rounded border text-[11px] font-bold font-mono-pos transition-colors ${guestOf(u) === g ? guestStyle(g) : "border-slate-800 text-slate-600 hover:text-slate-300"}`}>
                    G{g + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-5 gap-2 mb-5" data-testid="split-preview">
        {preview.map((amt, g) => (
          <div key={g} className={`rounded-lg border p-3 ${guestStyle(g)}`}>
            <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">Guest {g + 1}</div>
            <div className="font-mono-pos text-lg font-extrabold mt-1" data-testid={`split-preview-${g}`}>₹{amt.toFixed(2)}</div>
            {mode === "items" && <div className="text-[10px] opacity-70">{counts[g]} item{counts[g] === 1 ? "" : "s"}</div>}
          </div>
        ))}
      </div>

      {emptyGuest && <div className="text-xs text-amber-400 mb-3">Every guest needs at least one item.</div>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} data-testid="split-cancel-btn" className="border-slate-700 text-slate-300 hover:bg-slate-800">Back</Button>
        <Button onClick={create} disabled={busy || emptyGuest} data-testid="split-create-btn" className="bg-teal-600 hover:bg-teal-500 font-semibold">
          Split into {n} shares
        </Button>
      </div>
    </div>
  );
}
