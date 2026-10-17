import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BarChart3, Download, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const toIso = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => toIso(new Date());
const rs = (n) => `₹${Number(n || 0).toFixed(2)}`;

const Stat = ({ label, value, accent = "text-slate-100", testid }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={testid}>
    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
    <div className={`mt-2 text-2xl font-mono-pos font-extrabold ${accent}`}>{value}</div>
  </div>
);

const Table = ({ title, head, rows, testid }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden" data-testid={testid}>
    <div className="px-4 py-3 border-b border-slate-800 font-heading text-xs font-bold uppercase tracking-widest text-slate-300">{title}</div>
    <table className="w-full text-sm">
      <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-500">
        <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2 font-semibold ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={head.length} className="px-4 py-6 text-center text-slate-500">No data</td></tr>}
        {rows.map((r, ri) => (
          <tr key={ri} className="border-t border-slate-800">
            {r.map((c, i) => <td key={i} className={`px-4 py-2 ${i ? "text-right font-mono-pos text-slate-300" : "text-slate-200"}`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default function Reports() {
  const [date, setDate] = useState(today());
  const [rep, setRep] = useState(null);
  const [calOpen, setCalOpen] = useState(false);
  const tz = new Date().getTimezoneOffset();

  useEffect(() => {
    api.get("/reports/daily", { params: { date, tz_offset: tz } }).then(({ data }) => setRep(data));
  }, [date, tz]);

  const exportCsv = async () => {
    const res = await api.get("/reports/daily/csv", { params: { date, tz_offset: tz }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `sales-report-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const s = rep?.summary;
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">End of day · GST summary</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Daily Sales Report</h1>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <button data-testid="report-date-input"
                className="h-10 px-3 rounded-md bg-slate-900 border border-slate-800 hover:border-teal-500/50 flex items-center gap-2 font-mono-pos text-sm text-slate-100 transition-colors">
                <CalendarDays className="h-4 w-4 text-teal-400" />
                {new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0 bg-slate-900 border-slate-800 text-slate-100">
              <Calendar mode="single" selected={new Date(`${date}T00:00:00`)} disabled={{ after: new Date() }} toDate={new Date()}
                onSelect={(d) => { if (d) { setDate(toIso(d)); setCalOpen(false); } }} initialFocus />
            </PopoverContent>
          </Popover>
          <Button onClick={exportCsv} disabled={!rep} data-testid="report-export-csv-btn" className="h-10 bg-teal-600 hover:bg-teal-500">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </div>

      {!rep ? <div className="p-6 text-slate-500">Loading report...</div> : (
        <div className="flex-1 overflow-auto p-6 space-y-5">
          <div className="grid grid-cols-5 gap-3">
            <Stat label="Gross sales" value={rs(s.gross_sales)} accent="text-emerald-400" testid="report-gross" />
            <Stat label="Taxable value" value={rs(s.taxable_value)} testid="report-taxable" />
            <Stat label="CGST" value={rs(s.cgst)} accent="text-teal-300" testid="report-cgst" />
            <Stat label="SGST" value={rs(s.sgst)} accent="text-teal-300" testid="report-sgst" />
            <Stat label="Total GST" value={rs(s.total_tax)} accent="text-teal-400" testid="report-total-tax" />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Paid orders" value={s.paid_orders} testid="report-paid-orders" />
            <Stat label="Average ticket" value={rs(s.avg_ticket)} testid="report-avg-ticket" />
            <Stat label="Discounts" value={rs(s.discount)} accent="text-amber-300" testid="report-discount" />
            <Stat label={`Unpaid bills (${s.pending_orders})`} value={rs(s.pending_amount)} accent="text-rose-400" testid="report-pending" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Table title="GST breakdown by slab" testid="report-gst-table" head={["GST rate", "Taxable", "CGST", "SGST", "Total GST"]}
              rows={rep.gst_breakdown.map((g) => [`${g.rate}%`, rs(g.taxable), rs(g.cgst), rs(g.sgst), rs(g.total_tax)])} />
            <Table title="Payment modes" testid="report-modes-table" head={["Mode", "Orders", "Amount"]}
              rows={rep.payment_modes.map((m) => [m.mode, m.count, rs(m.amount)])} />
            <Table title="Sales channels" testid="report-channels-table" head={["Channel", "Orders", "Amount"]}
              rows={rep.channels.map((c) => [c.channel, c.count, rs(c.amount)])} />
            <Table title="Top items" testid="report-items-table" head={["Item", "Qty", "Amount"]}
              rows={rep.top_items.map((i) => [i.name, i.qty, rs(i.amount)])} />
          </div>

          <Table title={`Orders (${rep.orders.length})`} testid="report-orders-table"
            head={["Order #", "Time", "Channel", "Payment", "Taxable", "GST", "Total"]}
            rows={rep.orders.map((o) => [
              <span className="font-mono-pos">{o.order_number}</span>,
              new Date(o.created_at).toLocaleTimeString("en-GB", { hour12: false }),
              o.channel, `${o.payment_mode} · ${o.payment_status}`, rs(o.subtotal - (o.discount || 0)), rs(o.tax), rs(o.total),
            ])} />
        </div>
      )}
    </div>
  );
}
