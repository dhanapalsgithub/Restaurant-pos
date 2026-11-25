import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Boxes, Pencil, FolderPlus, Zap } from "lucide-react";
import { toast } from "sonner";
import ItemEditDialog from "./ItemEditDialog";
import CategoryDialog from "./CategoryDialog";

export default function MenuManager() {
  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", price: "", category_id: "", is_veg: true, tax_rate: 5.0 });

  const load = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([api.get("/categories"), api.get("/menu")]);
      setCats(c.data || []); 
      setItems(m.data || []);
      if (c.data && c.data.length > 0 && !newItem.category_id) {
        setNewItem((n) => ({ ...n, category_id: c.data[0].id }));
      }
    } catch (e) {
      toast.error("Failed to load menu or categories");
    }
  }, [newItem.category_id]);

  useEffect(() => { 
    load(); 
  }, [load]);

  const addPack = async () => {
    try {
      const { data } = await api.post("/menu/quick-pack");
      toast.success(data?.items_added ? `Added items successfully` : "Quick counter categories already added");
      load();
    } catch (e) {
      toast.error("Could not add quick pack");
    }
  };

  const toggle = async (id) => {
    try {
      const { data } = await api.post(`/menu/${id}/toggle-stock`);
      setItems((arr) => arr.map((x) => x.id === id ? { ...x, is_available: data.is_available } : x));
      toast.success(`Stock status updated: ${data.is_available ? "IN STOCK" : "OUT OF STOCK"}`);
    } catch (e) {
      toast.error("Could not update stock status");
    }
  };

  const addItem = async () => {
    if (!newItem.name || !newItem.price || !newItem.category_id) {
      return toast.error("தயவுசெய்து அனைத்து விவரங்களையும் நிரப்பவும் (Fill all fields)");
    }
    try {
      await api.post("/menu", { 
        ...newItem, 
        price: Number(newItem.price),
        tax_rate: Number(newItem.tax_rate) || 0
      });
      setAdding(false); 
      setNewItem({ name: "", price: "", category_id: cats[0]?.id || "", is_veg: true, tax_rate: 5.0 });
      load(); 
      toast.success("உணவுப் பொருள் வெற்றிகரமாகச் சேர்க்கப்பட்டது (Item added)");
    } catch (e) {
      toast.error("Failed to add item");
    }
  };

  const removeItem = async (id) => {
    try {
      await api.delete(`/menu/${id}`);
      load();
      toast.success("Item removed");
    } catch (e) {
      toast.error("Failed to delete item");
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Menu & Stock Management</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><Boxes className="h-6 w-6" /> Menu & Stock Manager</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={addPack} data-testid="menu-quick-pack-btn" className="border-amber-500/40 bg-amber-500/5 text-amber-300 hover:bg-amber-500/15">
            <Zap className="h-4 w-4 mr-2" /> Quick counter pack
          </Button>
          <Button variant="outline" onClick={() => setCatOpen(true)} data-testid="menu-add-category-btn" className="border-slate-700 text-slate-300 hover:bg-slate-800">
            <FolderPlus className="h-4 w-4 mr-2" /> Add category
          </Button>
          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogTrigger asChild>
              <Button data-testid="menu-add-btn" className="bg-teal-600 hover:bg-teal-500 text-white">
                <Plus className="h-4 w-4 mr-2" /> Add Item
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
              <DialogHeader><DialogTitle>Add new menu item (உணவுப் பொருள் சேர்க்க)</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <Input 
                  placeholder="Item name (உணவுப் பெயர் - தமிழ்/English)" 
                  value={newItem.name} 
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  data-testid="menu-new-name" 
                  className="bg-slate-950 border-slate-800 text-slate-100" 
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input 
                    type="number" 
                    placeholder="Price (விலை ₹)" 
                    value={newItem.price} 
                    onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
                    data-testid="menu-new-price" 
                    className="bg-slate-950 border-slate-800 font-mono-pos text-slate-100" 
                  />
                  <Input 
                    type="number" 
                    placeholder="GST Tax % (வரி)" 
                    value={newItem.tax_rate} 
                    onChange={(e) => setNewItem({ ...newItem, tax_rate: e.target.value })}
                    className="bg-slate-950 border-slate-800 font-mono-pos text-slate-100" 
                  />
                </div>
                <Select value={newItem.category_id} onValueChange={(v) => setNewItem({ ...newItem, category_id: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-100" data-testid="menu-new-category">
                    <SelectValue placeholder="Category தேர்ந்தெடுக்கவும்" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-100">
                    {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={newItem.is_veg} onCheckedChange={(v) => setNewItem({ ...newItem, is_veg: v })} data-testid="menu-new-veg" />
                  <span className="text-sm">சைவம் (Vegetarian)</span>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={addItem} data-testid="menu-new-save" className="bg-teal-600 hover:bg-teal-500 text-white w-full">
                  Save Item (பொருளைச் சேமி)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-400">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Item Name (உணவுப் பொருள்)</th>
                <th className="text-left px-4 py-3 font-semibold">Category (வகை)</th>
                <th className="text-right px-4 py-3 font-semibold">Price (விலை)</th>
                <th className="text-right px-4 py-3 font-semibold">Tax % (ஜிஎஸ்டி)</th>
                <th className="text-center px-4 py-3 font-semibold">Stock Status (இருப்பு நிலை)</th>
                <th className="w-20"></th>
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
                  <td className="px-4 py-3 text-right font-mono-pos text-emerald-400 font-semibold">₹{Number(i.price || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono-pos text-slate-400">{i.tax_rate}%</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${i.is_available ? "text-emerald-400" : "text-rose-400"}`}>
                        {i.is_available ? "IN STOCK" : "OUT"}
                      </span>
                      <Switch checked={i.is_available} onCheckedChange={() => toggle(i.id)} data-testid={`stock-toggle-${i.id}`} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => setEditing(i)} data-testid={`menu-edit-${i.id}`} className="text-slate-400 hover:text-teal-300">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => removeItem(i.id)} data-testid={`menu-delete-${i.id}`} className="text-slate-400 hover:text-rose-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-slate-500 py-12">No menu items found. Add items using the button above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <ItemEditDialog item={editing} cats={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      <CategoryDialog open={catOpen} onClose={() => setCatOpen(false)} onSaved={() => { setCatOpen(false); load(); }} />
    </div>
  );
}