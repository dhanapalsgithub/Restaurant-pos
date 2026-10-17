import React, { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, Landmark, Info } from "lucide-react";

export const ReportTabs = () => (
  <div className="flex gap-1 mt-2">
    {[["/reports", "Daily", "report-tab-daily"], ["/reports/monthly", "Monthly GST", "report-tab-monthly"]].map(([to, label, tid]) => (
      <NavLink key={to} to={to} end data-testid={tid}
        className={({ isActive }) => `px-3 h-7 rounded text-[11px] font-semibold uppercase tracking-wider flex items-center transition-colors ${isActive
          ? "bg-teal-500/15 text-teal-300 border border-teal-500/40" : "text-slate-400 hover:text-slate-200 border border-slate-800"}`}>
        {label}
      </NavLink>
    ))}
  </div>
);

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const shift = (m, by) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const label = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const rs = (n) => `₹${Number(n || 0).toFixed(2)}`;

const Stat = ({ title, value, accent = "text-slate-100", testid, hint }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={testid}>
    <div className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{title}</div>
    <div className={`mt-2 text-2xl font-mono-pos font-extrabold ${accent}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
  </div>
);

const Grid = ({ title, head, rows, testid, note }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden" data-testid={testid}>
    <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
      <span className="font-heading text-xs font-bold uppercase tracking-widest text-slate-300">{title}</span>
      {note && <span className="text-[10px] text-slate-500">{note}</span>}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-500">
          <tr>{head.map((h, i) => <th key={h} className={`px-4 py-2 font-semibold whitespace-nowrap ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-4 py-6 text-center text-slate-500">No data</td></tr>}
          {rows.map((r, ri) => (
            <tr key={ri} className="border-t border-slate-800">
              {r.map((c, i) => <td key={i} className={`px-4 py-2 whitespace-nowrap ${i ? "text-right font-mono-pos text-slate-300" : "text-slate-200"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default function MonthlyGst() {
  const [month, setMonth] = useState(thisMonth());
  const [rep, setRep] = useState(null);
  const tz = new Date().getTimezoneOffset();

  useEffect(() => {
    setRep(null);
    api.get("/reports/monthly", { params: { month, tz_offset: tz } }).then(({ data }) => setRep(data));
  }, [month, tz]);

  const download = async (kind) => {
    const res = await api.get("/reports/monthly/csv", { params: { month, kind, tz_offset: tz }, responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url; a.download = `gst-${kind}-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${kind.toUpperCase()} CSV exported`);
  };

  const s = rep?.summary;
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">GSTR-1 · GSTR-3B ready</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><Landmark className="h-6 w-6" /> Monthly GST Report</h1>
          <ReportTabs />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-md h-10 px-1">
            <button onClick={() => setMonth(shift(month, -1))} data-testid="month-prev-btn" className="h-8 w-8 rounded hover:bg-slate-800 flex items-center justify-center"><ChevronLeft className="h-4 w-4" /></button>
            <span className="font-mono-pos text-sm w-36 text-center" data-testid="month-label">{label(month)}</span>
            <button onClick={() => setMonth(shift(month, 1))} disabled={month >= thisMonth()} data-testid="month-next-btn"
              className="h-8 w-8 rounded hover:bg-slate-800 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <Button onClick={() => download("full")} disabled={!rep} data-testid="gst-export-full-btn" className="h-10 bg-teal-600 hover:bg-teal-500">
            <Download className="h-4 w-4 mr-2" /> Accountant CSV
          </Button>
        </div>
      </div>

      {!rep ? <div className="p-6 text-slate-500">Loading GST report...</div> : (
        <div className="flex-1 overflow-auto p-6 space-y-5">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>GSTIN <span className="font-mono-pos text-slate-200" data-testid="gst-gstin">{rep.gstin || "— add in Settings"}</span></span>
            <span>Place of supply <span className="font-mono-pos text-slate-200">{rep.place_of_supply || "—"}</span></span>
            <span>SAC <span className="font-mono-pos text-slate-200">996331</span></span>
          </div>

          <div className="grid grid-cols-5 gap-3">
            <Stat title="Gross sales (all)" value={rs(s.gross_sales)} accent="text-emerald-400" testid="gst-gross" hint={`${s.paid_orders} paid orders`} />
            <Stat title="Taxable · own supplies" value={rs(s.pos_taxable)} testid="gst-pos-taxable" hint="Dine-In + Takeaway" />
            <Stat title="CGST payable" value={rs(s.pos_cgst)} accent="text-teal-300" testid="gst-cgst" />
            <Stat title="SGST payable" value={rs(s.pos_sgst)} accent="text-teal-300" testid="gst-sgst" />
            <Stat title="Via aggregators · 9(5)" value={rs(s.eco_taxable)} accent="text-orange-300" testid="gst-eco-taxable" hint="GST paid by Swiggy/Zomato" />
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
            <FileSpreadsheet className="h-4 w-4 text-teal-400" />
            <span className="text-xs uppercase tracking-widest text-slate-300 font-semibold mr-2">GST offline tool CSVs</span>
            {[["b2cs", "B2CS"], ["hsn", "HSN summary"], ["docs", "Documents issued"]].map(([k, l]) => (
              <Button key={k} size="sm" variant="outline" onClick={() => download(k)} data-testid={`gst-export-${k}-btn`}
                className="h-8 border-slate-700 text-slate-200 bg-slate-950 hover:bg-slate-800 hover:text-white">
                <Download className="h-3.5 w-3.5 mr-1.5" /> {l}
              </Button>
            ))}
          </div>

          <Grid title="GSTR-3B · Table 3.1" testid="gst-3b-table" head={["Section", "Taxable", "IGST", "CGST", "SGST", "Cess"]}
            rows={rep.gstr3b.map((r) => [r.section, rs(r.taxable), rs(r.igst), rs(r.cgst), rs(r.sgst), rs(r.cess)])} />

          <div className="grid grid-cols-2 gap-4">
            <Grid title="GSTR-1 · B2CS" testid="gst-b2cs-table" head={["Type", "Place of supply", "Rate", "Taxable", "CGST", "SGST"]}
              rows={rep.b2cs.map((r) => [r.type, r.place_of_supply || "—", `${r.rate}%`, rs(r.taxable), rs(r.cgst), rs(r.sgst)])} />
            <Grid title="GSTR-1 · Documents issued" testid="gst-docs-table" head={["Nature", "From", "To", "Total", "Cancelled", "Net"]}
              rows={rep.docs.map((r) => [r.nature, r.from || "—", r.to || "—", r.total, r.cancelled, r.net_issued])} />
          </div>

          <Grid title="GSTR-1 · HSN / SAC summary" testid="gst-hsn-table"
            head={["SAC", "Description", "UQC", "Qty", "Total value", "Rate", "Taxable", "IGST", "CGST", "SGST"]}
            rows={rep.hsn.map((r) => [r.hsn, r.description, r.uqc, r.qty, rs(r.total_value), `${r.rate}%`, rs(r.taxable), rs(r.igst), rs(r.cgst), rs(r.sgst)])} />

          <div className="grid grid-cols-2 gap-4">
            <Grid title="E-commerce operator supplies u/s 9(5)" testid="gst-eco-table" note="Operator collects & pays this GST"
              head={["Operator", "Orders", "Taxable", "GST", "Total"]}
              rows={rep.eco.map((r) => [r.operator, r.orders, rs(r.taxable), rs(r.tax), rs(r.total)])} />
            <Grid title="Day-wise sales" testid="gst-daily-table" head={["Date", "Orders", "Taxable", "CGST", "SGST", "Total"]}
              rows={rep.daily.map((r) => [r.date, r.orders, rs(r.taxable), rs(r.cgst), rs(r.sgst), rs(r.total)])} />
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-500">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            All POS sales are reported as B2C (intra-state, CGST + SGST). Swiggy/Zomato orders fall under section 9(5): the platform pays that GST, so it shows in 3.1.1(ii), not in your payable tax. Check with your CA before filing.
          </div>
        </div>
      )}
    </div>
  );
}
