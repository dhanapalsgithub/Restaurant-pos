import React from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Undo2 } from "lucide-react";
import { GUEST_STYLES } from "./SplitSetup";

export default function SplitShares({ order, onPay, onUndo }) {
  const splits = order.splits || [];
  const paid = splits.filter((s) => s.status === "Paid");
  const paidAmt = paid.reduce((s, x) => s + x.amount, 0);
  const pct = Math.round((paidAmt / order.total) * 100);

  return (
    <div className="p-6" data-testid="split-shares">
      <div className="flex items-end justify-between mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Split bill</div>
          <div className="font-heading text-lg font-bold text-white">{paid.length} of {splits.length} shares paid</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Remaining</div>
          <div className="font-mono-pos text-xl font-extrabold text-amber-300" data-testid="split-remaining">₹{(order.total - paidAmt).toFixed(2)}</div>
        </div>
      </div>
      <div className="h-1.5 bg-slate-800 rounded overflow-hidden mb-4">
        <div className="h-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-2 max-h-80 overflow-auto">
        {splits.map((s, i) => (
          <div key={s.id} data-testid={`split-share-${i}`}
            className={`flex items-center gap-3 rounded-lg border p-3 ${s.status === "Paid" ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-950"}`}>
            <span className={`h-9 w-9 rounded-md border flex items-center justify-center font-mono-pos text-xs font-bold ${GUEST_STYLES[i % GUEST_STYLES.length]}`}>G{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-100">{s.label}</div>
              <div className="text-[11px] text-slate-500 truncate">
                {s.items?.length ? s.items.map((it) => `${it.qty}× ${it.name}`).join(", ") : "Equal share"}
              </div>
            </div>
            <span className="font-mono-pos font-bold text-emerald-400 w-24 text-right">₹{s.amount.toFixed(2)}</span>
            {s.status === "Paid" ? (
              <span className="w-24 flex items-center justify-end gap-1 text-xs font-bold uppercase tracking-wider text-emerald-400" data-testid={`split-share-paid-${i}`}>
                <CheckCircle2 className="h-3.5 w-3.5" /> {s.mode}
              </span>
            ) : (
              <Button size="sm" onClick={() => onPay(s)} data-testid={`split-pay-${i}`} className="w-24 h-8 bg-teal-600 hover:bg-teal-500">Collect</Button>
            )}
          </div>
        ))}
      </div>

      {paid.length === 0 && (
        <button onClick={onUndo} data-testid="split-undo-btn"
          className="mt-4 text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1.5 transition-colors">
          <Undo2 className="h-3.5 w-3.5" /> Undo split
        </button>
      )}
    </div>
  );
}
