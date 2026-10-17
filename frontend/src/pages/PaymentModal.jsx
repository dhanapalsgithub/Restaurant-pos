import React, { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Banknote, CreditCard, QrCode, CheckCircle2, Printer, Split, ArrowLeft } from "lucide-react";
import ReceiptPrint from "./ReceiptPrint";
import SplitSetup from "./SplitSetup";
import SplitShares from "./SplitShares";

export default function PaymentModal({ order, open, onClose, onPaid }) {
  const { subscribe, store } = useAuth();
  const [ord, setOrd] = useState(order);
  const [mode, setMode] = useState("UPI");
  const [tendered, setTendered] = useState(order?.total ?? 0);
  const [cardRef, setCardRef] = useState("");
  const [upi, setUpi] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | waiting | paid
  const [paidOrder, setPaidOrder] = useState(null);
  const [splitSetup, setSplitSetup] = useState(false);
  const [share, setShare] = useState(null);
  const pollRef = useRef(null);
  const shareRef = useRef(null);
  shareRef.current = share;

  const stopPoll = () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };
  const resetPay = (amount) => { stopPoll(); setUpi(null); setCardRef(""); setTendered(amount); setStatus("idle"); };

  const refresh = async () => {
    const { data } = await api.get(`/orders/${order.id}`);
    setOrd(data);
    if (data.payment_status === "Paid") { stopPoll(); setPaidOrder(data); setStatus("paid"); }
    return data;
  };

  const shareDone = (data, sid) => {
    if (data.payment_status === "Paid" || !shareRef.current || shareRef.current.id !== sid) return;
    setShare(null); resetPay(0);
  };

  React.useEffect(() => {
    if (!open || !order) return;
    setOrd(order); setPaidOrder(null); setShare(null); setSplitSetup(false); resetPay(order.total);
    refresh();
    return stopPoll;
  }, [open, order]);

  React.useEffect(() => {
    if (!open) return;
    return subscribe((m) => {
      if (m.order_id !== order?.id) return;
      if (m.type === "payment_success") refresh();
      if (m.type === "split_paid") refresh().then((d) => shareDone(d, m.split_id));
    });
  }, [open, order, subscribe]);

  const due = share ? share.amount : (ord?.total || 0);
  const q = share ? { params: { split_id: share.id } } : {};
  const change = Math.max(0, (Number(tendered) || 0) - due);
  const fail = (e) => toast.error(e?.response?.data?.detail || "Payment failed");

  const finish = async (msg) => {
    toast.success(msg);
    const sid = share?.id;
    const data = await refresh();
    if (sid) shareDone(data, sid);
  };

  const payCash = async () => {
    if (Number(tendered) < due) return toast.error("Tendered less than amount due");
    try {
      const { data } = await api.post(`/orders/${order.id}/pay/cash`, { tendered: Number(tendered) }, q);
      finish(`Cash paid · change ₹${data.change.toFixed(2)}`);
    } catch (e) { fail(e); }
  };

  const payCard = async () => {
    if (!cardRef.trim()) return toast.error("Enter EDC reference");
    try {
      await api.post(`/orders/${order.id}/pay/card`, { reference: cardRef }, q);
      finish("Card payment recorded");
    } catch (e) { fail(e); }
  };

  const startUpi = async () => {
    try {
      const { data } = await api.post(`/orders/${order.id}/pay/upi/initiate`, null, q);
      setUpi(data); setStatus("waiting");
    } catch (e) { return fail(e); }
    const sid = share?.id;
    pollRef.current = setInterval(async () => {
      const { data: st } = await api.get(`/orders/${order.id}/pay/upi/status`, sid ? { params: { split_id: sid } } : {});
      if (st.payment_status === "Paid") {
        stopPoll();
        const fresh = await refresh();
        if (sid) shareDone(fresh, sid);
      }
    }, 3000);
  };

  const payShare = (s) => { setShare(s); resetPay(s.amount); };
  const undoSplit = async () => {
    try { const { data } = await api.delete(`/orders/${order.id}/split`); setOrd(data); toast("Split removed"); }
    catch (e) { fail(e); }
  };

  const printAndClose = () => {
    window.print();
    setTimeout(() => { onPaid?.(paidOrder || order); onClose(); }, 400);
  };

  if (!order || !ord) return null;
  const hasSplits = (ord.splits || []).length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => {
      if (v) return;
      if (status === "paid") onPaid?.(paidOrder || order);
      onClose();
    }}>
      <DialogContent className="max-w-3xl bg-slate-900 border-slate-800 text-slate-100 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-slate-800 bg-slate-950">
          <DialogTitle className="font-heading text-lg flex items-center justify-between gap-3 pr-8">
            <span className="flex-1">Checkout · <span className="font-mono-pos text-teal-400">{ord.order_number}</span></span>
            {!hasSplits && !splitSetup && status === "idle" && (
              <button onClick={() => setSplitSetup(true)} data-testid="split-bill-btn"
                className="h-8 px-3 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors">
                <Split className="h-3.5 w-3.5" /> Split bill
              </button>
            )}
            <span className="font-mono-pos text-3xl text-emerald-400" data-testid="checkout-total">₹{ord.total.toFixed(2)}</span>
          </DialogTitle>
        </DialogHeader>

        {status === "paid" ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            </div>
            <h3 className="font-heading text-2xl font-bold text-white">Payment received</h3>
            <p className="text-sm text-slate-400 mt-1 mb-5">Order {ord.order_number} · {paidOrder?.payment_mode || mode}{hasSplits ? ` · ${ord.splits.length} shares` : ""}</p>
            <div className="flex gap-3">
              <Button onClick={printAndClose} className="bg-teal-600 hover:bg-teal-500" data-testid="print-receipt-btn">
                <Printer className="h-4 w-4 mr-2" /> Print receipt (Customer + KOT)
              </Button>
              <Button variant="outline" onClick={() => { onPaid?.(paidOrder || order); onClose(); }} data-testid="close-paid-btn"
                className="border-slate-700 text-slate-300 hover:bg-slate-800">Skip & New Order</Button>
            </div>
            <ReceiptPrint order={paidOrder || order} store={store} />
          </div>
        ) : splitSetup ? (
          <SplitSetup order={ord} onCancel={() => setSplitSetup(false)} onCreated={(o) => { setOrd(o); setSplitSetup(false); }} />
        ) : hasSplits && !share ? (
          <SplitShares order={ord} onPay={payShare} onUndo={undoSplit} />
        ) : (
          <>
            {share && (
              <div className="flex items-center justify-between px-6 py-2.5 bg-indigo-500/10 border-b border-indigo-500/30" data-testid="share-banner">
                <button onClick={() => { setShare(null); resetPay(0); }} data-testid="share-back-btn"
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300 hover:text-indigo-200">
                  <ArrowLeft className="h-3.5 w-3.5" /> All shares
                </button>
                <span className="text-sm text-indigo-200">Collecting <b>{share.label}</b> · <span className="font-mono-pos font-bold">₹{share.amount.toFixed(2)}</span></span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-0 border-b border-slate-800">
              {[
                { key: "UPI", icon: QrCode, color: "text-teal-400" },
                { key: "Cash", icon: Banknote, color: "text-emerald-400" },
                { key: "Card", icon: CreditCard, color: "text-indigo-400" },
              ].map(({ key, icon: Icon, color }) => (
                <button key={key} onClick={() => setMode(key)} data-testid={`pay-mode-${key.toLowerCase()}`}
                  className={`py-4 flex items-center justify-center gap-2 border-r last:border-r-0 border-slate-800 font-semibold text-sm transition
                    ${mode === key ? "bg-slate-800/60 border-b-2 border-b-teal-400 " + color : "text-slate-500 hover:text-slate-300"}`}>
                  <Icon className="h-4 w-4" /> {key}
                </button>
              ))}
            </div>

            <div className="p-6">
              {mode === "UPI" && (
                <div className="flex gap-6">
                  <div className="relative bg-white rounded-xl p-4 shrink-0" data-testid="upi-qr-container">
                    {upi ? (
                      <>
                        <QRCodeSVG value={upi.upi_string} size={240} level="M" includeMargin={false} />
                        <div className="scan-beam" />
                      </>
                    ) : (
                      <div className="h-[240px] w-[240px] flex items-center justify-center text-slate-500 border-2 border-dashed border-slate-300">
                        <QrCode className="h-20 w-20 opacity-30" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold mb-1">UPI / Razorpay</div>
                    <h3 className="font-heading text-xl font-bold text-white mb-3">Scan to pay ₹{due.toFixed(2)}</h3>
                    {!upi && (
                      <Button onClick={startUpi} data-testid="upi-generate-btn"
                        className="bg-teal-600 hover:bg-teal-500 self-start">
                        <QrCode className="h-4 w-4 mr-2" /> Generate Live QR
                      </Button>
                    )}
                    {upi && (
                      <>
                        <div className="text-sm text-slate-400 mb-2">Any UPI app · PhonePe / GPay / Paytm / BHIM</div>
                        <div className="flex items-center gap-2 text-xs font-mono-pos text-slate-500 mb-4 break-all bg-slate-950 p-2 rounded border border-slate-800">
                          {upi.upi_string}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-amber-400">
                          <span className="h-2 w-2 rounded-full bg-amber-400 pulse-dot" />
                          Waiting for payment confirmation...
                          {upi.demo_mode && <span className="text-xs text-slate-500 ml-2">(demo auto-confirms in ~12s)</span>}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {mode === "Cash" && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-emerald-400 font-semibold mb-1">Cash Tender</div>
                  <h3 className="font-heading text-xl font-bold text-white mb-4">Enter amount received</h3>
                  <Input type="number" value={tendered} onChange={(e) => setTendered(e.target.value)}
                    data-testid="cash-tendered-input"
                    className="bg-slate-950 border-slate-800 h-14 text-2xl font-mono-pos text-emerald-400" />
                  <div className="flex gap-2 mt-3">
                    {[100, 200, 500, 1000, 2000].map((v) => (
                      <button key={v} onClick={() => setTendered(v)} data-testid={`cash-preset-${v}`}
                        className="flex-1 py-2 rounded border border-slate-800 bg-slate-950 hover:bg-slate-800 font-mono-pos text-sm text-slate-300">
                        ₹{v}
                      </button>
                    ))}
                    <button onClick={() => setTendered(due)} data-testid="cash-preset-exact"
                      className="flex-1 py-2 rounded border border-teal-500/30 bg-teal-500/10 text-teal-300 font-mono-pos text-sm">EXACT</button>
                  </div>
                  <div className="mt-5 bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
                    <span className="text-sm uppercase tracking-wider text-slate-400 font-semibold">Change due</span>
                    <span className="font-mono-pos text-3xl font-extrabold text-emerald-400" data-testid="cash-change-display">₹{change.toFixed(2)}</span>
                  </div>
                  <Button onClick={payCash} data-testid="cash-confirm-btn"
                    className="w-full mt-4 h-12 bg-emerald-600 hover:bg-emerald-500 font-semibold">
                    <Banknote className="h-4 w-4 mr-2" /> Record Cash Payment
                  </Button>
                </div>
              )}

              {mode === "Card" && (
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-indigo-400 font-semibold mb-1">Card · EDC Terminal</div>
                  <h3 className="font-heading text-xl font-bold text-white mb-4">EDC approval reference</h3>
                  <Input value={cardRef} onChange={(e) => setCardRef(e.target.value)} placeholder="Approval code / RRN"
                    data-testid="card-ref-input"
                    className="bg-slate-950 border-slate-800 h-14 font-mono-pos text-slate-100" />
                  <Button onClick={payCard} data-testid="card-confirm-btn"
                    className="w-full mt-4 h-12 bg-indigo-600 hover:bg-indigo-500 font-semibold">
                    <CreditCard className="h-4 w-4 mr-2" /> Record Card Payment
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
