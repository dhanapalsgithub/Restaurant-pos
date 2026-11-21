import React, { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Scale, Plus, Upload, FileDown, Download, Trash2 } from "lucide-react";
import { ReportTabs } from "./MonthlyGst";
import DatePick, { toIso } from "@/components/DatePick";

const rs = (n) => `${Number(n) < 0 ? "-" : ""}₹${Math.abs(Number(n || 0)).toFixed(2)}`;
const TEMPLATE = "date,platform,amount,order_ref,reference\n2026-06-02,Swiggy,4520.50,,UTR123456789\n2026-06-02,Zomato,216.88,ZOM-12345678,UTR987654321\n";
const STATUS = { Matched: "text-emerald-400 bg-emerald-500/10", Short: "text-rose-300 bg-rose-500/15", Excess: "text-amber-300 bg-amber-500/10", Unsettled: "text-slate-400 bg-slate-800" };

const normDate = (s) => {
  const t = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : t;
};
const splitCsv = (line) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());

export function parsePayoutCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV has no data rows");
  const head = splitCsv(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = { date: col("date", "settlementdate", "payoutdate"), platform: col("platform", "aggregator", "channel"),
    amount: col("amount", "amountreceived", "netpayout", "payout"), ref: col("orderref", "orderid", "order"), utr: col("reference", "utr", "utrno") };
  if (ci.date < 0 || ci.platform < 0 || ci.amount < 0) throw new Error("CSV needs date, platform and amount columns");
  return lines.slice(1).map((l, i) => {
    const c = splitCsv(l);
    const plat = (c[ci.platform] || "").toLowerCase();
    const platform = plat.startsWith("swig") ? "Swiggy" : plat.startsWith("zom") ? "Zomato" : null;
    const amount = Number(String(c[ci.amount] || "").replace(/[₹,\s]/g, ""));
    if (!platform || !Number.isFinite(amount)) throw new Error(`Row ${i + 2}: check platform and amount`);
    return { date: normDate(c[ci.date]), platform, amount, order_ref: ci.ref >= 0 ? c[ci.ref] || "" : "", reference: ci.utr >= 0 ? c[ci.utr] || "" : "" };
  });
}

function RecordPayout({ open, onClose, onSaved }) {
  const [f, setF] = useState({ date: toIso(new Date()), platform: "Swiggy", amount: "", order_ref: "", reference: "" });
  const save = async () => {
    if (!(Number(f.amount) > 0)) return toast.error("Enter the amount received");
    try { await api.post("/payouts", { ...f, amount: Number(f.amount) }); toast.success("Payout recorded"); onSaved(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not save"); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-slate-100" data-testid="record-payout-dialog">
        <DialogHeader><DialogTitle>Record bank settlement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2 items-center">
            <DatePick value={f.date} onChange={(d) => setF({ ...f, date: d })} testid="payout-date" />
            {["Swiggy", "Zomato"].map((p) => (
              <button key={p} onClick={() => setF({ ...f, platform: p })} data-testid={`payout-platform-${p.toLowerCase()}`}
                className={`flex-1 h-10 rounded-md border text-sm font-semibold ${f.platform === p ? "border-teal-400 bg-teal-500/10 text-teal-300" : "border-slate-700 text-slate-400"}`}>{p}</button>
            ))}
          </div>
          <Input type="number" placeholder="Amount received (₹)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="payout-amount" className="bg-slate-950 border-slate-800 font-mono-pos h-11" />
          <Input placeholder="Platform order ID (optional, matches one order)" value={f.order_ref} onChange={(e) => setF({ ...f, order_ref: e.target.value })} data-testid="payout-order-ref" className="bg-slate-950 border-slate-800 font-mono-pos" />
          <Input placeholder="UTR / bank reference (optional)" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} data-testid="payout-reference" className="bg-slate-950 border-slate-800 font-mono-pos" />
        </div>
        <DialogFooter><Button onClick={save} data-testid="payout-save-btn" className="bg-teal-600 hover:bg-teal-500">Save payout</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const Card = ({ r, testid }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg p-4" data-testid={testid}>
    <div className="flex items-center justify-between mb-3">
      <span className="font-heading text-sm font-bold uppercase tracking-widest text-slate-200">{r.platform}</span>
      <span className="text-[11px] text-slate-500">{r.orders} orders</span>
    </div>
    {[["Gross sales", r.gross_order_amount, "text-slate-100"], ["Commission + GST", -(r.commission_amount + r.gst_on_commission), "text-rose-300"],
      ["Restaurant discount + TDS", -(r.discount_borne_by_restaurant + r.tds_tcs_deduction), "text-rose-300"],
      ["Expected net payout", r.net_receivable_amount, "text-teal-300"], ["Actual received", r.actual_received, "text-emerald-400"]].map(([l, v, c]) => (
      <div key={l} className="flex justify-between text-sm py-0.5"><span className="text-slate-400">{l}</span><span className={`font-mono-pos font-semibold ${c}`}>{rs(v)}</span></div>
    ))}
    <div className={`mt-2 pt-2 border-t border-slate-800 flex justify-between font-bold ${r.difference < -0.99 ? "text-rose-400" : r.difference > 0.99 ? "text-amber-300" : "text-emerald-400"}`}>
      <span className="text-xs uppercase tracking-widest">{r.difference < -0.99 ? "Shortfall" : r.difference > 0.99 ? "Excess" : "Matched"}</span>
      <span className="font-mono-pos text-lg" data-testid={`${testid}-diff`}>{rs(r.difference)}</span>
    </div>
  </div>
);

export default function Reconciliation() {
  const now = new Date();
  const [start, setStart] = useState(toIso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [end, setEnd] = useState(toIso(now));
  const [rep, setRep] = useState(null);
  const [recOpen, setRecOpen] = useState(false);
  const fileRef = useRef(null);
  const tz = now.getTimezoneOffset();

  const load = useCallback(async () => {
    try { setRep((await api.get("/reports/reconciliation", { params: { start, end, tz_offset: tz } })).data); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not load report"); }
  }, [start, end, tz]);
  useEffect(() => { load(); }, [load]);

  const blobDownload = (blob, name) => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); };
  const exportCsv = async () => {
    try { blobDownload((await api.get("/reports/reconciliation/csv", { params: { start, end, tz_offset: tz }, responseType: "blob" })).data, `payout-reconciliation-${start}-to-${end}.csv`); }
    catch { toast.error("Export failed"); }
  };
  const upload = async (file) => {
    try {
      const rows = parsePayoutCsv(await file.text());
      const { data } = await api.post("/payouts/bulk", { rows });
      toast.success(`${data.inserted} payout rows imported`); load();
    } catch (e) { toast.error(e?.response?.data?.detail?.toString?.() || e.message || "Upload failed"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };
  const del = async (id) => { await api.delete(`/payouts/${id}`); load(); };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-orange-400 font-semibold">Commission · payout matching</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><Scale className="h-6 w-6" /> Swiggy / Zomato Reconciliation</h1>
          <ReportTabs />
        </div>
        <div className="flex items-center gap-2">
          <DatePick value={start} onChange={setStart} testid="recon-start" />
          <span className="text-slate-600">→</span>
          <DatePick value={end} onChange={setEnd} testid="recon-end" />
          <Button onClick={exportCsv} disabled={!rep} data-testid="recon-export-btn" className="h-10 bg-teal-600 hover:bg-teal-500"><Download className="h-4 w-4 mr-2" /> Export</Button>
        </div>
      </div>
      {!rep ? <div className="p-6 text-slate-500">Loading...</div> : (
        <div className="flex-1 overflow-auto p-6 space-y-5">
          <div className="grid grid-cols-3 gap-4">
            {rep.platforms.map((r) => <Card key={r.platform} r={r} testid={`recon-${r.platform.toLowerCase()}`} />)}
            <Card r={{ ...rep.totals, platform: "Total" }} testid="recon-total" />
          </div>
          <div className="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-4 py-3">
            <Button size="sm" onClick={() => setRecOpen(true)} data-testid="recon-record-btn" className="h-9 bg-teal-600 hover:bg-teal-500"><Plus className="h-4 w-4 mr-1.5" /> Record payout</Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="recon-upload-btn" className="h-9 border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"><Upload className="h-4 w-4 mr-1.5" /> Upload payout CSV</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="recon-file-input" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button size="sm" variant="ghost" onClick={() => blobDownload(new Blob([TEMPLATE], { type: "text/csv" }), "payout-template.csv")} data-testid="recon-template-btn" className="h-9 text-slate-400 hover:text-white"><FileDown className="h-4 w-4 mr-1.5" /> CSV template</Button>
            <span className="text-[11px] text-slate-500 ml-auto">Rows with an order ref are matched order-wise; the rest count toward the platform total.</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden" data-testid="recon-orders-table">
            <div className="px-4 py-3 border-b border-slate-800 font-heading text-xs font-bold uppercase tracking-widest text-slate-300">Orders ({rep.orders.length})</div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-500 sticky top-0">
                  <tr>{["Order", "Platform ID", "Gross", "Commission", "GST on comm.", "Discount", "TDS/TCS", "Expected", "Received", "Diff", "Status"].map((h, i) => <th key={h} className={`px-3 py-2 whitespace-nowrap ${i < 2 ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rep.orders.length === 0 && <tr><td colSpan={11} className="text-center text-slate-500 py-8">No Swiggy/Zomato orders in this range</td></tr>}
                  {rep.orders.map((o) => (
                    <tr key={o.id} className="border-t border-slate-800 font-mono-pos text-slate-300">
                      <td className="px-3 py-2 text-slate-100">{o.order_number} <span className="text-[10px] text-slate-500">{o.platform}</span></td>
                      <td className="px-3 py-2 text-slate-400">{o.platform_order_id || "—"}</td>
                      {[o.gross_order_amount, o.commission_amount, o.gst_on_commission, o.discount_borne_by_restaurant, o.tds_tcs_deduction, o.net_receivable_amount].map((v, i) => <td key={i} className="px-3 py-2 text-right">{rs(v)}</td>)}
                      <td className="px-3 py-2 text-right">{o.received == null ? "—" : rs(o.received)}</td>
                      <td className={`px-3 py-2 text-right ${o.difference < 0 ? "text-rose-400" : ""}`}>{o.difference == null ? "—" : rs(o.difference)}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STATUS[o.status]}`} data-testid={`recon-status-${o.order_number}`}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden" data-testid="recon-payouts-table">
            <div className="px-4 py-3 border-b border-slate-800 font-heading text-xs font-bold uppercase tracking-widest text-slate-300">Bank settlements ({rep.payouts.length})</div>
            {rep.payouts.length === 0 && <div className="text-center text-slate-500 py-6 text-sm">No payouts recorded in this range</div>}
            {rep.payouts.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-4 py-2 border-t border-slate-800 text-sm font-mono-pos">
                <span className="text-slate-400 w-24">{p.date}</span><span className="w-20 text-slate-200">{p.platform}</span>
                <span className="flex-1 text-slate-500 truncate">{p.order_ref || "—"} · {p.reference || "—"}</span>
                <span className="text-emerald-400 font-bold">{rs(p.amount)}</span>
                <button onClick={() => del(p.id)} data-testid={`payout-delete-${p.id}`} className="text-slate-500 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <RecordPayout open={recOpen} onClose={() => setRecOpen(false)} onSaved={() => { setRecOpen(false); load(); }} />
    </div>
  );
}
