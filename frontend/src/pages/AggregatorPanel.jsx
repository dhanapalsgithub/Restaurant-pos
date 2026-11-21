import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { AGG_DEFAULT } from "./AggregatorSettings";

const r2 = (n) => Math.round(n * 100) / 100;
export function calcNet(o, cfg, discount, tds) {
  const taxable = o.subtotal - (o.discount || 0);
  const base = cfg.commission_base === "gross" ? o.total : taxable;
  const commission = r2(base * cfg.commission_percent / 100);
  const gst = r2(commission * cfg.gst_on_commission_percent / 100);
  const t = tds ?? r2(taxable * (cfg.tds_tcs_percent || 0) / 100);
  return { commission, gst, tds: t, discount, net: r2(o.total - commission - gst - discount - t) };
}

const Row = ({ l, v, c = "text-rose-300" }) => (
  <div className="flex justify-between text-[12px]"><span className="text-slate-500">{l}</span><span className={`font-mono-pos ${c}`}>{v}</span></div>
);

export default function AggregatorPanel({ order, onSaved }) {
  const { store } = useAuth();
  const has = !!order.commission_base;
  const cfg0 = has ? { commission_percent: order.commission_percent, gst_on_commission_percent: order.gst_on_commission_percent, commission_base: order.commission_base }
    : { ...AGG_DEFAULT, ...(store?.aggregator_settings || {})[order.channel] };
  const cur = has ? { commission: order.commission_amount, gst: order.gst_on_commission, discount: order.discount_borne_by_restaurant, tds: order.tds_tcs_deduction, net: order.net_receivable_amount }
    : calcNet(order, cfg0, 0);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(null);

  const start = () => { setF({ ...cfg0, discount: cur.discount, tds: cur.tds }); setOpen(true); };
  const preview = f && calcNet(order, f, Number(f.discount) || 0, Number(f.tds) || 0);
  const save = async () => {
    try {
      await api.put(`/orders/${order.id}/aggregator`, {
        commission_percent: Number(f.commission_percent), gst_on_commission_percent: Number(f.gst_on_commission_percent),
        commission_base: f.commission_base, discount_borne_by_restaurant: Number(f.discount) || 0, tds_tcs_deduction: Number(f.tds) || 0,
      });
      toast.success("Payout figures updated"); setOpen(false); onSaved?.();
    } catch (e) { toast.error(e?.response?.data?.detail?.toString?.() || "Could not update"); }
  };
  const num = (k, label) => (
    <label className="text-[10px] uppercase tracking-wider text-slate-400">{label}
      <Input type="number" min={0} step="0.01" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`agg-edit-${k}`}
        className="mt-1 h-9 bg-slate-950 border-slate-800 font-mono-pos text-slate-100" />
    </label>
  );

  return (
    <div className="rounded-md bg-slate-950 border border-slate-800 p-2.5 space-y-0.5" data-testid={`agg-panel-${order.id}`}>
      <Row l={`Commission ${cfg0.commission_percent}% (${cfg0.commission_base === "gross" ? "on bill" : "on items"})`} v={`-₹${cur.commission.toFixed(2)}`} />
      <Row l={`GST on commission ${cfg0.gst_on_commission_percent}%`} v={`-₹${cur.gst.toFixed(2)}`} />
      {cur.discount > 0 && <Row l="Restaurant discount" v={`-₹${cur.discount.toFixed(2)}`} />}
      {cur.tds > 0 && <Row l="TDS / TCS" v={`-₹${cur.tds.toFixed(2)}`} />}
      <div className="flex items-center justify-between pt-1 mt-1 border-t border-slate-800">
        <button onClick={start} data-testid={`agg-edit-btn-${order.id}`} className="text-[11px] text-slate-500 hover:text-teal-300 flex items-center gap-1"><Pencil className="h-3 w-3" /> Adjust</button>
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Net receivable</span>
        <span className="font-mono-pos font-extrabold text-teal-300" data-testid={`agg-net-${order.id}`}>₹{cur.net.toFixed(2)}</span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-slate-100" data-testid="agg-edit-dialog">
          <DialogHeader><DialogTitle>{order.channel} payout · {order.order_number}</DialogTitle></DialogHeader>
          {f && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {num("commission_percent", "Commission %")}{num("gst_on_commission_percent", "GST on commission %")}
                {num("discount", "Restaurant-funded discount ₹")}{num("tds", "TDS / TCS ₹")}
              </div>
              <div className="flex gap-1.5">
                {[["subtotal", "Item total before GST"], ["gross", "Full bill incl. GST"]].map(([k, l]) => (
                  <button key={k} onClick={() => setF({ ...f, commission_base: k })} data-testid={`agg-edit-base-${k}`}
                    className={`flex-1 h-8 rounded-md border text-xs font-semibold ${f.commission_base === k ? "border-teal-400 bg-teal-500/10 text-teal-300" : "border-slate-700 text-slate-400"}`}>{l}</button>
                ))}
              </div>
              <div className="rounded-md bg-slate-950 border border-slate-800 p-3 flex justify-between items-center">
                <span className="text-xs text-slate-400">Gross ₹{order.total.toFixed(2)} → Net receivable</span>
                <span className={`font-mono-pos text-xl font-extrabold ${preview.net < 0 ? "text-rose-400" : "text-teal-300"}`} data-testid="agg-edit-preview">₹{preview.net.toFixed(2)}</span>
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={save} data-testid="agg-edit-save" className="bg-teal-600 hover:bg-teal-500">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
