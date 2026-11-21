import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { connectBluetooth, connectSerial, getPrinterSettings, onPrinterChange, printerStatus } from "@/lib/printer";

export default function PrinterChip() {
  const nav = useNavigate();
  const [st, setSt] = useState(printerStatus());
  const [cfg, setCfg] = useState(getPrinterSettings());
  useEffect(() => onPrinterChange((s) => { setSt(s); setCfg(getPrinterSettings()); }), []);

  const direct = cfg.mode !== "dialog";
  const click = async () => {
    if (!direct || st.connected) return nav("/settings");
    try {
      const name = cfg.mode === "bluetooth" ? await connectBluetooth() : await connectSerial();
      toast.success(`Printer connected · ${name}`);
    } catch (e) { if (e?.name !== "NotFoundError") toast.error(e.message || "Could not connect printer"); }
  };
  const tone = !direct ? "border-slate-700 text-slate-400" : st.connected
    ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" : "bg-amber-500/10 border-amber-500/40 text-amber-300";
  const label = !direct ? `Dialog · ${cfg.width}mm` : st.connected ? `${st.name.slice(0, 14)} · ${cfg.width}mm` : "Connect printer";

  return (
    <button onClick={click} data-testid="printer-chip"
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border font-mono-pos tracking-wider text-[11px] transition-colors hover:brightness-125 ${tone}`}>
      <Printer className="h-3 w-3" /> {label}
    </button>
  );
}
