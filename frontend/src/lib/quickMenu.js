import {
  Coffee, CupSoda, Croissant, Flame, UtensilsCrossed, IceCreamCone, Cookie, Sandwich, Pizza, GlassWater, CakeSlice, Soup,
} from "lucide-react";

export const ICONS = {
  coffee: Coffee, "cup-soda": CupSoda, croissant: Croissant, flame: Flame, utensils: UtensilsCrossed,
  "ice-cream": IceCreamCone, cookie: Cookie, sandwich: Sandwich, pizza: Pizza, "glass-water": GlassWater,
  cake: CakeSlice, soup: Soup,
};

export const COLORS = {
  amber: { card: "bg-amber-500/10 border-amber-500/40 hover:border-amber-400", text: "text-amber-300", solid: "bg-amber-500", chip: "bg-amber-500/20 text-amber-200 border-amber-500/50" },
  lime: { card: "bg-lime-500/10 border-lime-500/40 hover:border-lime-400", text: "text-lime-300", solid: "bg-lime-500", chip: "bg-lime-500/20 text-lime-200 border-lime-500/50" },
  orange: { card: "bg-orange-500/10 border-orange-500/40 hover:border-orange-400", text: "text-orange-300", solid: "bg-orange-500", chip: "bg-orange-500/20 text-orange-200 border-orange-500/50" },
  rose: { card: "bg-rose-500/10 border-rose-500/40 hover:border-rose-400", text: "text-rose-300", solid: "bg-rose-500", chip: "bg-rose-500/20 text-rose-200 border-rose-500/50" },
  teal: { card: "bg-teal-500/10 border-teal-500/40 hover:border-teal-400", text: "text-teal-300", solid: "bg-teal-500", chip: "bg-teal-500/20 text-teal-200 border-teal-500/50" },
  sky: { card: "bg-sky-500/10 border-sky-500/40 hover:border-sky-400", text: "text-sky-300", solid: "bg-sky-500", chip: "bg-sky-500/20 text-sky-200 border-sky-500/50" },
  emerald: { card: "bg-emerald-500/10 border-emerald-500/40 hover:border-emerald-400", text: "text-emerald-300", solid: "bg-emerald-500", chip: "bg-emerald-500/20 text-emerald-200 border-emerald-500/50" },
  pink: { card: "bg-pink-500/10 border-pink-500/40 hover:border-pink-400", text: "text-pink-300", solid: "bg-pink-500", chip: "bg-pink-500/20 text-pink-200 border-pink-500/50" },
};

export const iconFor = (key) => ICONS[key] || UtensilsCrossed;
export const colorFor = (key) => COLORS[key] || COLORS.teal;

// Default choice = first option of every modifier
export const defaultChoice = (item) => (item.modifiers || []).map((m) => m.options[0]);

export const lineFromChoice = (item, choice, qty) => {
  const extra = choice.reduce((s, o) => s + (o?.price || 0), 0);
  const notes = choice.filter((o) => o && !["Normal", "None"].includes(o.label)).map((o) => o.label).join(", ");
  return {
    key: `${item.id}|${choice.map((o) => o?.label).join("|")}`,
    id: item.id, name: item.name, price: item.price + extra, qty, tax_rate: item.tax_rate ?? 5, notes,
  };
};
