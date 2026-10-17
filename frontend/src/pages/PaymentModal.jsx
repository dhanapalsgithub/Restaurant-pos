import React, { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Banknote, CreditCard, QrCode, CheckCircle2, Printer } from "lucide-react";
import ReceiptPrint from "./ReceiptPrint";

export default function PaymentModal({ order, open, onClose, onPaid }) {
  const { subscribe, store } = useAuth();
  const [mode, setMode] = useState("UPI");
  const [tendered, setTendered] = useState(order?.total ?? 0);
  const [cardRef, setCardRef] = useState("");
  const [upi, setUpi] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | waiting | paid
  const [paidOrder, setPaidOrder] = useState(null);
  const pollRef = useRef(null);

  React.useEffect(() => { if (open) { setTendered(order?.total ?? 0); setStatus("idle"); setUpi(null); setPaidOrder(null); } }, [open, order]);

  // Listen for websocket payment_success
  React.useEffect(() => {
    if (!open) return;
    return subscribe((m) => {
      if (m.type === "payment_success" && m.order_id === order?.id) {
        setStatus("paid"); setPaidOrder({ ...order, payment_status: "Paid", payment_mode: m.mode, payment_ref: m.payment_id || "" });
        toast.success("Payment confirmed via " + m.mode);
      }
    });
  }, [open, order, subscribe]);

  const change = Math.max(0, (Number(tendered) || 0) - (order?.total || 0));

  const payCash = async () => {
    if (Number(tendered) < order.total) return toast.error("Tendered less than total");
    const { data } = await api.post(`/orders/${order.id}/pay/cash`, { tendered: Number(tendered) });
    setStatus("paid"); setPaidOrder({ ...order, payment_status: "Paid", payment_mode: "Cash" });
    toast.success(`Cash paid · change ₹${data.change.toFixed(2)}`);
  };

  const payCard = async () => {
    if (!cardRef.trim()) return toast.error("Enter EDC reference");
    await api.post(`/orders/${order.id}/pay/card`, { reference: cardRef });
    setStatus("paid"); setPaidOrder({ ...order, payment_status: "Paid", payment_mode: "Card", payment_ref: cardRef });
    toast.success("Card payment recorded");
  };

  const startUpi = async () => {
    const { data } = await api.post(`/orders/${order.id}/pay/upi/initiate`);
    setUpi(data); setStatus("waiting");
    // Fallback polling in case WS misses
    pollRef.current = setInterval(async () => {
      const { data: st } = await api.get(`/orders/${order.id}/pay/upi/status`);
      if (st.payment_status === "Paid") {
        clearInterval(pollRef.current);
        setStatus("paid");
        setPaidOrder({ ...order, payment_status: "Paid", payment_mode: "UPI", payment_ref: st.payment_ref });
      }
    }, 3000);
  };

  React.useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const printAndClose = () => {
    window.print();
    setTimeout(() => { onPaid?.(paidOrder || order); onClose(); }, 400);
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl bg-slate-900 border-slate-800 text-slate-100 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-slate-800 bg-slate-950">
          <DialogTitle className="font-heading text-lg flex items-center justify-between">
            <span>Checkout · <span className="font-mono-pos text-teal-400">{order.order_number}</span></span>
            <span className="font-mono-pos text-3xl text-emerald-400">₹{order.total.toFixed(2)}</span>
          </DialogTitle>
        </DialogHeader>

        {status === "paid" ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            </div>
            <h3 className="font-heading text-2xl font-bold text-white">Payment received</h3>
            <p className="text-sm text-slate-400 mt-1 mb-5">Order {order.order_number} · {paidOrder?.payment_mode || mode}</p>
            <div className="flex gap-3">
              <Button onClick={printAndClose} className="bg-teal-600 hover:bg-teal-500" data-testid="print-receipt-btn">
                <Printer className="h-4 w-4 mr-2" /> Print receipt (Customer + KOT)
              </Button>
              <Button variant="outline" onClick={() => { onPaid?.(paidOrder || order); onClose(); }} data-testid="close-paid-btn"
                className="border-slate-700 text-slate-300 hover:bg-slate-800">Skip & New Order</Button>
            </div>
            <ReceiptPrint order={paidOrder || order} store={store} />
          </div>
        ) : (
          <>
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
                    <h3 className="font-heading text-xl font-bold text-white mb-3">Scan to pay ₹{order.total.toFixed(2)}</h3>
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
                    <button onClick={() => setTendered(order.total)} data-testid="cash-preset-exact"
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
