import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toast } from "sonner";

export const modsToText = (mods = []) => mods.map((m) => `${m.name}: ${m.options.map((o) => (o.price ? `${o.label} +${o.price}` : o.label)).join(", ")}`).join("\n");
export function parseMods(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l, n) => {
    const at = l.indexOf(":");
    if (at < 1) throw new Error(`Line ${n + 1}: use "Name: option, option"`);
    const options = l.slice(at + 1).split(",").map((s) => {
      const m = s.trim().match(/^(.*?)(?:\s*\+\s*(\d+(?:\.\d+)?))?$/);
      return { label: m[1].trim(), price: Number(m[2] || 0) };
    }).filter((o) => o.label);
    if (!options.length) throw new Error(`Line ${n + 1}: add at least one option`);
    return { name: l.slice(0, at).trim(), options };
  });
}

export default function ItemEditDialog({ item, cats, onClose, onSaved }) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (item) setF({ ...item, mods: modsToText(item.modifiers), price: String(item.price), stock_qty: String(item.stock_qty ?? 0), low_stock_threshold: String(item.low_stock_threshold ?? 10) });
  }, [item]);
  if (!item || !f) return null;

  const save = async () => {
    let modifiers;
    try { modifiers = parseMods(f.mods); } catch (e) { return toast.error(e.message); }
    const price = Number(f.price); const qty = Number(f.stock_qty); const low = Number(f.low_stock_threshold);
    if (!f.name.trim() || !(price >= 0) || !(qty >= 0) || !(low >= 0)) return toast.error("Check name, price and stock values");
    try {
      await api.put(`/menu/${item.id}`, {
        name: f.name.trim(), price, tax_rate: Number(f.tax_rate) || 0, category_id: f.category_id, modifiers,
        track_stock: f.track_stock, stock_qty: qty, low_stock_threshold: low,
        ...(f.track_stock ? { is_available: qty > 0 } : {}),
      });
      toast.success("Item saved"); onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail?.toString?.() || "Could not save"); }
  };
  const inp = (k, label, type = "text") => (
    <label className="text-[10px] uppercase tracking-wider text-slate-400">{label}
      <Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`item-edit-${k}`} className="mt-1 h-9 bg-slate-950 border-slate-800 font-mono-pos text-slate-100" />
    </label>
  );

  return (
    <Dialog open={!!item} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-slate-100" data-testid="item-edit-dialog">
        <DialogHeader><DialogTitle>Edit {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">{inp("name", "Name")}{inp("price", "Price ₹", "number")}{inp("tax_rate", "GST %", "number")}</div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">Category
            <select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} data-testid="item-edit-category"
              className="mt-1 w-full h-9 rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-sm px-2">
              {cats.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
            </select>
          </label>
          <div className="rounded-md border border-slate-800 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm"><Switch checked={f.track_stock} onCheckedChange={(v) => setF({ ...f, track_stock: v })} data-testid="item-edit-track" /> Track stock count</label>
            {f.track_stock && <div className="grid grid-cols-2 gap-2">{inp("stock_qty", "Stock on hand", "number")}{inp("low_stock_threshold", "Low-stock alert at", "number")}</div>}
          </div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-400">Options / variants (one per line)
            <textarea value={f.mods} onChange={(e) => setF({ ...f, mods: e.target.value })} rows={3} data-testid="item-edit-mods"
              placeholder={"Size: Normal, Strong +2\nSugar: Normal, Less, No Sugar"}
              className="mt-1 w-full rounded-md bg-slate-950 border border-slate-800 text-slate-100 text-sm p-2 font-mono-pos normal-case tracking-normal" />
          </label>
        </div>
        <DialogFooter><Button onClick={save} data-testid="item-edit-save" className="bg-teal-600 hover:bg-teal-500">Save item</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
