import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";

export const toIso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };

export default function DatePick({ value, onChange, testid }) {
  const [open, setOpen] = useState(false);
  const d = new Date(`${value}T00:00:00`);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid={testid}
          className="h-10 px-3 rounded-md bg-slate-900 border border-slate-800 hover:border-teal-500/50 flex items-center gap-2 font-mono-pos text-sm text-slate-100 transition-colors">
          <CalendarDays className="h-4 w-4 text-teal-400" />
          {d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0 bg-slate-900 border-slate-800 text-slate-100">
        <Calendar mode="single" selected={d} disabled={{ after: new Date() }} toDate={new Date()}
          onSelect={(x) => { if (x) { onChange(toIso(x)); setOpen(false); } }} initialFocus />
      </PopoverContent>
    </Popover>
  );
}
