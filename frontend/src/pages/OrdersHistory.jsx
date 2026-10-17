import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Receipt } from "lucide-react";

const CHANNEL_COLORS = {
  POS: "bg-indigo-500/10 text-indigo-400 border-indigo-500/40",
  Swiggy: "bg-orange-500/10 text-orange-400 border-orange-500/40",
  Zomato: "bg-rose-500/10 text-rose-400 border-rose-500/40",
};

export default function OrdersHistory() {
  const [orders, setOrders] = useState([]);
  const load = async () => { const { data } = await api.get("/orders", { params: { limit: 200 } }); setOrders(data); };
  useEffect(() => { load(); }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950">
        <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Last 200 Orders</div>
        <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2"><Receipt className="h-6 w-6" /> Orders History</h1>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="text-left px-4 py-3">Order #</th>
                <th className="text-left px-4 py-3">Channel</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Items</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-center px-4 py-3">Payment</th>
                <th className="text-center px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/30" data-testid={`history-row-${o.id}`}>
                  <td className="px-4 py-3 font-mono-pos text-slate-200">{o.order_number}</td>
                  <td className="px-4 py-3"><span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${CHANNEL_COLORS[o.channel] || "border-slate-700 text-slate-400"}`}>{o.channel}</span></td>
                  <td className="px-4 py-3 text-slate-400">{o.order_type}</td>
                  <td className="px-4 py-3 text-slate-400">{o.items.length} items</td>
                  <td className="px-4 py-3 text-right font-mono-pos font-bold text-emerald-400">₹{o.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[10px] font-bold uppercase ${o.payment_status === "Paid" ? "text-emerald-400" : "text-amber-400"}`}>
                      {o.payment_mode} · {o.payment_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-400">{o.order_status}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500 font-mono-pos">{new Date(o.created_at).toLocaleString("en-GB", { hour12: false })}</td>
                </tr>
              ))}
              {orders.length === 0 && <tr><td colSpan={8} className="text-center text-slate-500 py-10">No orders yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
