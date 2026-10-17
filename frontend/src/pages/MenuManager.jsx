import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Boxes } from "lucide-react";
import { toast } from "sonner";

export default function MenuManager() {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: "", category_id: "", is_veg: true });

  const load = async () => {
    const [c, m] = await Promise.all([api.get("/categories"), api.get("/menu")]);
    setCats(c.data); setItems(m.data);
    if (c.data.length && !newItem.category_id) setNewItem((n) => ({ ...n, category_id: c.data[0].id }));
  };
  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    const { data } = await api.post(`/menu/${id}/toggle-stock`);
    setItems((arr) => arr.map((x) => x.id === id ? { ...x, is_available: data.is_available } : x));
    toast.success(`Synced to UrbanPiper · ${data.is_available ? "IN STOCK" : "OUT OF STOCK"}`);
  };

  const addItem = async () => {
    if (!newItem.name || !newItem.price || !newItem.category_id) return toast.error("Fill all fields");
    await api.post("/menu", { ...newItem, price: Number(newItem.price) });
    setAdding(false); setNewItem({ name: "", price: "", category_id: cats[0]?.id || "", is_veg: true });
    load(); toast.success("Item added");
  };

  const removeItem = async (id) => { await api.delete(`/menu/${id}`); load(); };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">UrbanPiper Sync Enabled</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><Boxes className="h-6 w-6" /> Menu & Stock Manager</h1>
        </div>
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogTrigger asChild>
            <Button data-testid="menu-add-btn" className="bg-teal-600 hover:bg-teal-500"><Plus className="h-4 w-4 mr-2" /> Add Item</Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
            <DialogHeader><DialogTitle>Add menu item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Item name" value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                data-testid="menu-new-name" className="bg-slate-950 border-slate-800" />
              <Input type="number" placeholder="Price (₹)" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                data-testid="menu-new-price" className="bg-slate-950 border-slate-800 font-mono-pos" />
              <Select value={newItem.category_id} onValueChange={(v) => setNewItem({ ...newItem, category_id: v })}>
                <SelectTrigger className="bg-slate-950 border-slate-800" data-testid="menu-new-category"><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch checked={newItem.is_veg} onCheckedChange={(v) => setNewItem({ ...newItem, is_veg: v })} data-testid="menu-new-veg" />
                <span className="text-sm">Veg</span>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={addItem} data-testid="menu-new-save" className="bg-teal-600 hover:bg-teal-500">Save item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Item</th>
                <th className="text-left px-4 py-3 font-semibold">Category</th>
                <th className="text-right px-4 py-3 font-semibold">Price</th>
                <th className="text-right px-4 py-3 font-semibold">Tax</th>
                <th className="text-center px-4 py-3 font-semibold">Stock</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-slate-800 hover:bg-slate-800/30" data-testid={`menu-row-${i.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-sm border ${i.is_veg ? "border-emerald-500 bg-emerald-500/20" : "border-rose-500 bg-rose-500/20"}`} />
                      <span className="text-slate-100 font-medium">{i.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{cats.find((c) => c.id === i.category_id)?.name || "-"}</td>
                  <td className="px-4 py-3 text-right font-mono-pos text-emerald-400 font-semibold">₹{i.price.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono-pos text-slate-400">{i.tax_rate}%</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${i.is_available ? "text-emerald-400" : "text-rose-400"}`}>
                        {i.is_available ? "IN STOCK" : "OUT"}
                      </span>
                      <Switch checked={i.is_available} onCheckedChange={() => toggle(i.id)} data-testid={`stock-toggle-${i.id}`} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => removeItem(i.id)} data-testid={`menu-delete-${i.id}`} className="text-slate-500 hover:text-rose-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-10">No items yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
