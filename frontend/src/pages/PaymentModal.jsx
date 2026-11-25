import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { QrCode, Banknote, CreditCard } from "lucide-react";
import { printOrder } from "@/lib/printer";
import { useAuth } from "@/lib/auth";

export default function PaymentModal({ order, open, onClose, onPaid }) {
  const [tab, setTab] = useState("upi"); // upi, cash, card
  const [tendered, setTendered] = useState("");
  const { store } = useAuth();

  if (!order) return null;

  const total = order.total || 0;
  const paidNum = parseFloat(tendered) || total;
  const balance = +(paidNum - total).toFixed(2);

  const completePayment = async (mode) => {
    try {
      let endpoint = `/orders/${order.id}/pay/cash`;
      let payload = { amount_tendered: paidNum };

      if (mode === "upi") {
        endpoint = `/orders/${order.id}/pay/upi/simulate-success`;
        payload = {};
      } else if (mode === "card") {
        endpoint = `/orders/${order.id}/pay/card`;
        payload = {};
      }

      const { data } = await api.post(endpoint, payload);
      toast.success(`Payment successful via ${mode.toUpperCase()}`);
      
      const updatedOrder = data.order || { ...order, payment_mode: mode.toUpperCase(), payment_status: "Paid" };
      
      // Auto print receipt via bluetooth or dialog based on settings
      await printOrder(updatedOrder, store);

      onPaid(updatedOrder);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payment failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-slate-100" data-testid="payment-modal">
        <DialogHeader>
          <DialogTitle className="flex justify-between items-center">
            <span>Checkout · {order.order_number}</span>
            <span className="text-teal-400 font-mono-pos text-xl">₹{total.toFixed(2)}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Payment Type Tabs */}
        <div className="grid grid-cols-3 gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setTab("upi")}
            className={`py-2 rounded font-semibold text-xs flex items-center justify-center gap-2 ${tab === "upi" ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            <QrCode className="h-4 w-4" /> UPI
          </button>
          <button
            onClick={() => setTab("cash")}
            className={`py-2 rounded font-semibold text-xs flex items-center justify-center gap-2 ${tab === "cash" ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            <Banknote className="h-4 w-4" /> Cash
          </button>
          <button
            onClick={() => setTab("card")}
            className={`py-2 rounded font-semibold text-xs flex items-center justify-center gap-2 ${tab === "card" ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"}`}
          >
            <CreditCard className="h-4 w-4" /> Card
          </button>
        </div>

        {/* Content based on selected tab */}
        <div className="py-4 space-y-4">
          {tab === "upi" && (
            <div className="text-center py-6 space-y-4">
              <p className="text-sm text-slate-300">வாடிக்கையாளர் UPI மூலம் செலுத்துவதை உறுதிப்படுத்தவும் (Confirm UPI Payment)</p>
              <Button onClick={() => completePayment("upi")} className="w-full h-12 bg-teal-600 hover:bg-teal-500 font-bold">
                Confirm UPI Payment & Print
              </Button>
            </div>
          )}

          {tab === "cash" && (
            <div className="space-y-3">
              <label className="text-xs text-slate-400">வாடிக்கையாளர் கொடுத்த பணம் (Cash Tendered)</label>
              <Input
                type="number"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder={total.toFixed(2)}
                className="bg-slate-950 border-slate-800 text-lg font-mono-pos"
              />
              <div className="flex justify-between text-sm bg-slate-950 p-3 rounded border border-slate-800">
                <span className="text-slate-400">மீதித் சில்லறை (Change Due):</span>
                <span className="font-mono-pos text-emerald-400 font-bold">₹{balance >= 0 ? balance.toFixed(2) : "0.00"}</span>
              </div>
              <Button onClick={() => completePayment("cash")} className="w-full h-12 bg-teal-600 hover:bg-teal-500 font-bold mt-2">
                Record Cash Payment & Print
              </Button>
            </div>
          )}

          {tab === "card" && (
            <div className="text-center py-6 space-y-4">
              <p className="text-sm text-slate-300">கார்டு ஸ்வைப் இயந்திரத்தில் பேமெண்ட் முடிக்கப்பட்டுள்ளது</p>
              <Button onClick={() => completePayment("card")} className="w-full h-12 bg-teal-600 hover:bg-teal-500 font-bold">
                Confirm Card Payment & Print
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}