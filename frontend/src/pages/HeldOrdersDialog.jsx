import React, { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { PauseCircle, RotateCcw, Trash2 } from "lucide-react";

const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
};

export default function HeldOrdersDialog({ open, onClose, onRecall, onChanged }) {
  const [list, setList] = useState([]);

  const load = useCallback(async () => {
    const { data } = await api.get("/held-orders");
    setList(data);
    onChanged?.(data.length);
  }, [onChanged]);

  useEffect(() => { 
    if (open) load(); 
  }, [open, load]);

  const discard = async (id) => {
    await api.delete(`/held-orders/${id}`);
    toast("Held order discarded");
    load();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl bg-slate-900 border-slate-800 text-slate-100" data-testid="held-orders-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <PauseCircle className="h-5 w-5 text-amber-400" /> Held orders
            <span className="font-mono-pos text-sm text-slate-500">({list.length})</span>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto space-y-2">
          {list.length === 0 && <div className="text-center text-slate-500 py-10 text-sm">No parked bills</div>}
          {list.map((h) => (
            <div key={h.id} className="bg-slate-950 border border-slate-800 rounded-md p-3 flex items-center gap-3" data-testid={`held-order-${h.id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${h.order_type === "Dine-In" ? "border-indigo-500/40 text-indigo-300 bg-indigo-500/10" : "border-amber-500/40 text-amber-300 bg-amber-500/10"}`}>
                    {h.table_no ? `Table ${h.table_no}` : h.order_type}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono-pos">{ago(h.updated_at)}</span>
                </div>
                <div className="text-xs text-slate-400 mt-1 truncate">
                  {h.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                </div>
              </div>
              <span className="font-mono-pos font-bold text-emerald-400">₹{h.total.toFixed(2)}</span>
              <Button size="sm" onClick={() => onRecall(h)} data-testid={`held-recall-${h.id}`} className="bg-teal-600 hover:bg-teal-500 h-8">
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Recall
              </Button>
              <button onClick={() => discard(h.id)} data-testid={`held-discard-${h.id}`} className="text-slate-500 hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}