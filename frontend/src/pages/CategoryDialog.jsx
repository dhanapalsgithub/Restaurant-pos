import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { ICONS, COLORS } from "@/lib/quickMenu";

export default function CategoryDialog({ open, category = null, onClose, onSaved }) {
  const [f, setF] = useState({ name: "", icon: "coffee", color: "amber" });

  useEffect(() => {
    if (category) {
      setF({
        name: category.name || "",
        icon: category.icon || "coffee",
        color: category.color || "amber",
      });
    } else {
      setF({ name: "", icon: "coffee", color: "amber" });
    }
  }, [category, open]);

  const save = async () => {
    if (!f.name.trim()) return toast.error("Enter a category name");
    try {
      const payload = { ...f, name: f.name.trim() };
      if (category?.id) {
        await api.put(`/categories/${category.id}`, payload);
        toast.success("Category updated");
      } else {
        await api.post("/categories", payload);
        toast.success("Category added");
      }
      setF({ name: "", icon: "coffee", color: "amber" });
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail?.toString?.() || "Could not save category");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-slate-100" data-testid="category-dialog">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "Add category"}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="e.g. Hot Beverages (Tea/Coffee)"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          data-testid="category-name"
          className="bg-slate-950 border-slate-800"
        />
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Icon</div>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(ICONS).map(([k, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setF({ ...f, icon: k })}
              data-testid={`category-icon-${k}`}
              className={`h-11 rounded-lg border-2 flex items-center justify-center ${
                f.icon === k ? "border-teal-400 bg-teal-500/10 text-teal-200" : "border-slate-800 text-slate-400"
              }`}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Colour</div>
        <div className="flex gap-2">
          {Object.entries(COLORS).map(([k, c]) => (
            <button
              key={k}
              type="button"
              onClick={() => setF({ ...f, color: k })}
              data-testid={`category-color-${k}`}
              className={`h-8 w-8 rounded-full ${c.solid} ${
                f.color === k ? "ring-2 ring-white ring-offset-2 ring-offset-slate-900" : "opacity-70"
              }`}
            />
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} data-testid="category-save" className="bg-teal-600 hover:bg-teal-500">
            {category ? "Save changes" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}