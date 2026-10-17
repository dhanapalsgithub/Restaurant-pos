import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TrendingUp, ShoppingBag, IndianRupee, Flame, Clock } from "lucide-react";

const StatCard = ({ icon: Icon, label, value, accent = "text-teal-400", testid }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg p-5" data-testid={testid}>
    <div className="flex items-center justify-between">
      <div className="text-[11px] uppercase tracking-widest text-slate-500 font-semibold">{label}</div>
      <Icon className={`h-4 w-4 ${accent}`} />
    </div>
    <div className={`mt-3 text-3xl font-mono-pos font-extrabold ${accent}`}>{value}</div>
  </div>
);

export default function Dashboard() {
  const { store, subscribe } = useAuth();
  const [data, setData] = useState(null);

  const load = async () => { const { data } = await api.get("/dashboard"); setData(data); };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  useEffect(() => subscribe((m) => { if (["order_created","online_order","payment_success"].includes(m.type)) load(); }), [subscribe]);

  if (!data) return <div className="p-6 text-slate-500">Loading dashboard...</div>;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Live Overview</div>
          <h1 className="font-heading text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <div className="text-sm text-slate-500 mt-1">{store?.store_name} · {new Date().toDateString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={IndianRupee} label="Today's sales" value={`₹${data.today_sales.toFixed(2)}`} accent="text-emerald-400" testid="stat-sales" />
        <StatCard icon={ShoppingBag} label="Today's orders" value={data.today_orders} accent="text-teal-400" testid="stat-orders" />
        <StatCard icon={Flame} label="Online (Swiggy+Zomato)" value={(data.channels.Swiggy||0) + (data.channels.Zomato||0)} accent="text-orange-400" testid="stat-online" />
        <StatCard icon={TrendingUp} label="POS Orders" value={data.channels.POS || 0} accent="text-indigo-400" testid="stat-pos" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-300 mb-4">Payment modes · today</h3>
          <div className="space-y-3">
            {Object.entries(data.payment_modes).map(([mode, cnt]) => {
              const total = Object.values(data.payment_modes).reduce((a,b)=>a+b,0) || 1;
              const pct = Math.round((cnt / total) * 100);
              const colors = { Cash: "bg-emerald-500", Card: "bg-indigo-500", UPI: "bg-teal-500", Online: "bg-orange-500", Pending: "bg-slate-600" };
              return (
                <div key={mode}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 font-medium">{mode}</span>
                    <span className="font-mono-pos text-slate-400">{cnt} · {pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded overflow-hidden">
                    <div className={`h-full ${colors[mode] || "bg-slate-500"}`} style={{width: `${pct}%`}} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-5">
          <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-300 mb-4">Recent orders</h3>
          <div className="space-y-2">
            {data.recent.length === 0 && <div className="text-sm text-slate-500">No orders yet today</div>}
            {data.recent.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded bg-slate-950 border border-slate-800">
                <div className="flex items-center gap-3">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  <span className="font-mono-pos text-sm text-slate-200">{o.order_number}</span>
                  <span className="text-xs text-slate-500">{o.channel}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${o.payment_status === 'Paid' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>{o.payment_status}</span>
                  <span className="font-mono-pos font-bold text-emerald-400">₹{o.total.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
