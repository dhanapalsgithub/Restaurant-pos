import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { defaultChoice } from "@/lib/quickMenu";

export default function ModifierPicker({ item, qty, onClose, onAdd }) {
  const [choice, setChoice] = useState([]);
  useEffect(() => { if (item) setChoice(defaultChoice(item)); }, [item]);
  if (!item) return null;
  const extra = choice.reduce((s, o) => s + (o?.price || 0), 0);

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-slate-100" data-testid="modifier-picker">
        <DialogHeader><DialogTitle className="font-heading text-xl">{item.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {item.modifiers.map((m, mi) => (
            <div key={m.name}>
              <div className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mb-2">{m.name}</div>
              <div className="flex flex-wrap gap-2">
                {m.options.map((o) => {
                  const on = choice[mi]?.label === o.label;
                  return (
                    <button key={o.label} onClick={() => setChoice((c) => c.map((x, i) => (i === mi ? o : x)))}
                      data-testid={`modifier-${mi}-${o.label.replace(/\s+/g, "-").toLowerCase()}`}
                      className={`h-12 px-4 rounded-lg border-2 text-sm font-semibold transition-colors ${on ? "border-teal-400 bg-teal-500/15 text-teal-200" : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"}`}>
                      {o.label}{o.price ? <span className="ml-1 font-mono-pos text-xs opacity-80">+₹{o.price}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Button onClick={() => onAdd(choice)} data-testid="modifier-add-btn" className="h-14 mt-2 bg-teal-600 hover:bg-teal-500 text-base font-bold">
          Add {qty > 1 ? `${qty} × ` : ""}· ₹{((item.price + extra) * qty).toFixed(2)}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
