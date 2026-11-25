import React, { useEffect, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Flame, Timer, CheckCircle2, Package, Truck } from "lucide-react";
import AggregatorPanel from "./AggregatorPanel";

const CHANNEL_STYLES = {
  Swiggy: "bg-orange-500/10 text-orange-400 border-orange-500/40",
  Zomato: "bg-rose-500/10 text-rose-400 border-rose-500/40",
};
const STATUS_FLOW = ["Placed", "Accepted", "Preparing", "Ready", "Dispatched"];
const STATUS_ICON = { Placed: Flame, Accepted: CheckCircle2, Preparing: Timer, Ready: Package, Dispatched: Truck };

export default function OnlineOrders() {
  const { subscribe } = useAuth();
  const outlet = useOutletContext();
  const [orders, setOrders] = useState([]);
  const [autoAccept, setAutoAccept] = useState(() => localStorage.getItem("auto_accept") === "1");

  const load = useCallback(async () => {
    const { data } = await api.get("/orders", { params: { limit: 50 } });
    setOrders(data.filter((o) => o.channel === "Swiggy" || o.channel === "Zomato"));
  }, []);

  useEffect(() => { 
    load(); 
    outlet?.clearOnlineCount?.(); 
  }, [load, outlet]);

  useEffect(() => subscribe((m) => {
    if (m.type === "online_order") {
      load();
      if (autoAccept) {
        setTimeout(() => api.put(`/orders/${m.order.id}/status`, { order_status: "Accepted" }).then(load), 500);
      }
    }
    if (m.type === "order_updated") load();
  }), [subscribe, autoAccept, load]);

  const toggleAuto = (v) => { setAutoAccept(v); localStorage.setItem("auto_accept", v ? "1" : "0"); toast(`Auto-accept ${v ? "enabled" : "disabled"}`); };
  const update = async (id, s) => { await api.put(`/orders/${id}/status`, { order_status: s }); load(); };

  const simulate = async (channel) => {
    await api.post("/simulate/online-order", {
      channel,
      items: [
        { name: "Chicken Biryani", qty: 1, price: 320, tax_rate: 5 },
        { name: "Butter Naan", qty: 2, price: 60, tax_rate: 5 },
      ],
    });
    toast(`Simulated ${channel} order incoming via webhook`);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-orange-400 font-semibold">Live via UrbanPiper</div>
          <h1 className="font-heading text-2xl font-bold text-white">Online Orders</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Auto-accept</span>
            <Switch checked={autoAccept} onCheckedChange={toggleAuto} data-testid="auto-accept-toggle" />
          </div>
          <Button onClick={() => simulate("Swiggy")} data-testid="simulate-swiggy-btn"
            variant="outline" className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10">
            Simulate Swiggy
          </Button>
          <Button onClick={() => simulate("Zomato")} data-testid="simulate-zomato-btn"
            variant="outline" className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
            Simulate Zomato
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {orders.length === 0 && (
          <div className="text-center py-20">
            <Flame className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <div className="text-slate-500">No online orders yet. Simulate one or wait for UrbanPiper webhook.</div>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {orders.map((o) => {
            const idx = STATUS_FLOW.indexOf(o.order_status);
            const nextStatus = STATUS_FLOW[idx + 1];
            const Icon = STATUS_ICON[o.order_status] || Flame;
            return (
              <div key={o.id} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden slide-in" data-testid={`online-order-${o.id}`}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${CHANNEL_STYLES[o.channel]}`}>{o.channel}</span>
                    <span className="font-mono-pos text-sm text-slate-200">{o.order_number}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono-pos">
                    {new Date(o.created_at).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                </div>
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Icon className="h-3.5 w-3.5 text-teal-400" />
                    <span className="uppercase tracking-widest font-bold text-teal-400">{o.order_status}</span>
                    <span className="text-slate-500 ml-auto font-mono-pos">{o.customer_name || "Customer"}</span>
                  </div>
                  <div className="text-sm text-slate-300 space-y-0.5 pt-2 border-t border-slate-800 min-h-[60px]">
                    {o.items.map((it, idx2) => (
                      <div key={idx2} className="flex justify-between font-mono-pos text-[13px]">
                        <span className="truncate">{it.qty} × {it.name}</span>
                        <span className="text-slate-500">₹{(it.price * it.qty).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Paid Online</span>
                    <span className="font-mono-pos text-xl font-extrabold text-emerald-400">₹{o.total.toFixed(2)}</span>
                  </div>
                  <AggregatorPanel order={o} onSaved={load} />
                  <div className="flex gap-2 pt-1">
                    {nextStatus && (
                      <Button size="sm" onClick={() => update(o.id, nextStatus)} data-testid={`online-advance-${o.id}`}
                        className="flex-1 bg-teal-600 hover:bg-teal-500 h-8 text-xs">Mark {nextStatus}</Button>
                    )}
                    {!nextStatus && <span className="flex-1 text-center text-xs text-emerald-400 font-semibold py-2">✓ Completed</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}