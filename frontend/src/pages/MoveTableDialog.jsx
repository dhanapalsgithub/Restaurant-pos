import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ArrowRightLeft, Merge } from "lucide-react";

const BADGE = {
  Free: "text-emerald-400",
  Occupied: "text-amber-300",
  Billed: "text-rose-300",
};

export default function MoveTableDialog({ source, tables, onClose, onDone }) {
  const go = async (t) => {
    try {
      const { data } = await api.post("/tables/move", { from_table: source.name, to_table: t.name });
      toast.success(data.action === "merged" ? `${source.name} merged into ${t.name}` : `${source.name} moved to ${t.name}`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.detail || "Could not move table"); }
  };

  return (
    <Dialog open={!!source} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-slate-100" data-testid="move-table-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-indigo-400" /> Move or merge {source?.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-400 -mt-2">Pick a free table to move the bill, or a busy table to merge both bills into one.</p>
        <div className="grid grid-cols-3 gap-2 max-h-[55vh] overflow-auto">
          {tables.filter((t) => t.name !== source?.name).map((t) => {
            const merge = t.status !== "Free";
            return (
              <button key={t.id} onClick={() => go(t)} data-testid={`move-target-${t.name}`}
                className={`text-left rounded-lg border-2 p-3 bg-slate-950 transition-[border-color,transform] hover:-translate-y-0.5 ${merge ? "border-amber-500/30 hover:border-amber-400" : "border-slate-800 hover:border-emerald-500/60"}`}>
                <div className="flex items-center justify-between">
                  <span className="font-heading text-lg font-extrabold">{t.name}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${BADGE[t.status]}`}>{t.status}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className={`flex items-center gap-1 font-semibold uppercase tracking-wider ${merge ? "text-amber-300" : "text-emerald-400"}`}>
                    {merge ? <Merge className="h-3 w-3" /> : <ArrowRightLeft className="h-3 w-3" />} {merge ? "Merge" : "Move"}
                  </span>
                  {merge && <span className="font-mono-pos text-slate-400">₹{t.running_total.toFixed(2)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
