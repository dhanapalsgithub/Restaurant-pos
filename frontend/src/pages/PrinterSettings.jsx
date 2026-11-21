import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Bluetooth, Cable, Printer, TestTube2 } from "lucide-react";
import {
  connectBluetooth, connectSerial, disconnectPrinter, getPrinterSettings, onPrinterChange, printerStatus, printOrder, savePrinterSettings,
} from "@/lib/printer";
import { useAuth } from "@/lib/auth";

const MODES = [
  ["bluetooth", "Bluetooth printer", Bluetooth, "Direct ESC/POS to a BLE thermal printer (Chrome/Edge)"],
  ["serial", "USB / Bluetooth COM port", Cable, "For printers paired as a COM port in Windows"],
  ["dialog", "Print dialog", Printer, "Any installed printer driver"],
];

export default function PrinterSettings() {
  const { store } = useAuth();
  const [cfg, setCfg] = useState(getPrinterSettings());
  const [st, setSt] = useState(printerStatus());
  useEffect(() => onPrinterChange(setSt), []);
  const set = (patch) => { const n = { ...cfg, ...patch }; setCfg(n); savePrinterSettings(n); };

  const connect = async () => {
    try {
      const name = cfg.mode === "bluetooth" ? await connectBluetooth() : await connectSerial();
      toast.success(`Connected · ${name}`);
    } catch (e) { if (e?.name !== "NotFoundError") toast.error(e.message || "Could not connect"); }
  };
  const test = async () => {
    const how = await printOrder({
      order_number: "TEST", order_type: "Takeaway", created_at: new Date().toISOString(), payment_mode: "Cash",
      items: [{ name: "Masala Tea", qty: 2, price: 20, notes: "Strong, Less" }, { name: "Veg Puff", qty: 1, price: 20 }],
      subtotal: 60, tax: 3, total: 63,
    }, store, { kot: false });
    toast(how === "dialog" ? "Opened print dialog" : "Test page sent");
  };

  return (
    <div className="space-y-4" data-testid="printer-settings">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(([k, label, Icon, hint]) => (
          <button key={k} onClick={() => set({ mode: k })} data-testid={`printer-mode-${k}`}
            className={`text-left rounded-lg border-2 p-3 transition-colors ${cfg.mode === k ? "border-teal-400 bg-teal-500/10" : "border-slate-800 bg-slate-950 hover:border-slate-600"}`}>
            <Icon className={`h-5 w-5 mb-1.5 ${cfg.mode === k ? "text-teal-300" : "text-slate-400"}`} />
            <div className="text-sm font-semibold text-slate-100">{label}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-400">Paper</span>
          {[58, 80].map((w) => (
            <button key={w} onClick={() => set({ width: w })} data-testid={`printer-width-${w}`}
              className={`h-8 px-3 rounded-md border font-mono-pos text-sm ${cfg.width === w ? "border-teal-400 text-teal-300 bg-teal-500/10" : "border-slate-700 text-slate-400"}`}>{w}mm</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Switch checked={cfg.autoPrint} onCheckedChange={(v) => set({ autoPrint: v })} data-testid="printer-autoprint" /> Auto-print on Quick Counter
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <Switch checked={cfg.kot} onCheckedChange={(v) => set({ kot: v })} data-testid="printer-kot" /> Print KOT with restaurant bills
        </label>
      </div>
      <div className="flex items-center gap-3">
        {cfg.mode !== "dialog" && (st.connected
          ? <Button variant="outline" onClick={disconnectPrinter} data-testid="printer-disconnect-btn" className="border-slate-700 text-slate-300 hover:bg-slate-800">Disconnect {st.name}</Button>
          : <Button onClick={connect} data-testid="printer-connect-btn" className="bg-teal-600 hover:bg-teal-500">{cfg.mode === "bluetooth" ? <Bluetooth className="h-4 w-4 mr-2" /> : <Cable className="h-4 w-4 mr-2" />} Connect printer</Button>)}
        <Button variant="outline" onClick={test} data-testid="printer-test-btn" className="border-slate-700 text-slate-300 hover:bg-slate-800"><TestTube2 className="h-4 w-4 mr-2" /> Test print</Button>
        <span className="text-xs text-slate-500">Saved on this device. Reconnect the printer after reloading the page (tap the printer chip at the top).</span>
      </div>
    </div>
  );
}
