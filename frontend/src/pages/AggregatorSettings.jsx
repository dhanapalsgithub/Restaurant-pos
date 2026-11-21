import React from "react";
import { Input } from "@/components/ui/input";

export const AGG_DEFAULT = { commission_percent: 20, gst_on_commission_percent: 18, commission_base: "subtotal", tds_tcs_percent: 0 };
const FIELDS = [["commission_percent", "Commission %"], ["gst_on_commission_percent", "GST on commission %"], ["tds_tcs_percent", "TDS/TCS % (optional)"]];

export default function AggregatorSettings({ value, onChange }) {
  const v = value || {};
  const set = (p, patch) => onChange({ ...v, [p]: { ...AGG_DEFAULT, ...v[p], ...patch } });
  return (
    <div className="grid grid-cols-2 gap-4" data-testid="aggregator-settings">
      {["Swiggy", "Zomato"].map((p) => {
        const cfg = { ...AGG_DEFAULT, ...v[p] };
        return (
          <div key={p} className={`rounded-lg border p-4 bg-slate-950 ${p === "Swiggy" ? "border-orange-500/30" : "border-rose-500/30"}`}>
            <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${p === "Swiggy" ? "text-orange-400" : "text-rose-400"}`}>{p}</div>
            <div className="grid grid-cols-3 gap-2">
              {FIELDS.map(([k, label]) => (
                <label key={k} className="text-[10px] uppercase tracking-wider text-slate-400">
                  {label}
                  <Input type="number" min={0} max={100} step="0.01" value={cfg[k]} data-testid={`agg-${p.toLowerCase()}-${k}`}
                    onChange={(e) => set(p, { [k]: e.target.value === "" ? 0 : Math.min(100, Math.max(0, Number(e.target.value))) })}
                    className="mt-1 h-9 bg-slate-900 border-slate-800 font-mono-pos text-slate-100" />
                </label>
              ))}
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-wider text-slate-400">Commission charged on</div>
            <div className="flex gap-1.5 mt-1">
              {[["subtotal", "Item total before GST"], ["gross", "Full bill incl. GST"]].map(([k, l]) => (
                <button key={k} onClick={() => set(p, { commission_base: k })} data-testid={`agg-${p.toLowerCase()}-base-${k}`}
                  className={`flex-1 h-8 rounded-md border text-xs font-semibold ${cfg.commission_base === k ? "border-teal-400 bg-teal-500/10 text-teal-300" : "border-slate-700 text-slate-400"}`}>{l}</button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
