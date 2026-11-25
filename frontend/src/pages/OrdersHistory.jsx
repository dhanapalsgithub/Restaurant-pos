import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Receipt, Calendar, Filter, ShoppingBag, Utensils, Coffee } from "lucide-react";

export default function OrdersHistory() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("ALL"); // ALL, Dine-In, Takeaway

  const loadOrders = async () => {
    try {
      const { data } = await api.get("/orders");
      setOrders(data || []);
    } catch (e) {
      toast.error("Failed to load orders history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // --- Summary Calculations ---
  const totalOrdersCount = orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  
  const dineInCount = orders.filter(o => o.order_type?.toLowerCase() === "dine-in").length;
  const dineInRevenue = orders.filter(o => o.order_type?.toLowerCase() === "dine-in").reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  const takeawayCount = orders.filter(o => o.order_type?.toLowerCase() === "takeaway").length;
  const takeawayRevenue = orders.filter(o => o.order_type?.toLowerCase() === "takeaway").reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  // Category wise breakdown (Tiffin, Tea, Beverages, etc.)
  const categoryStats = {};
  orders.forEach(o => {
    if (Array.isArray(o.items)) {
      o.items.forEach(i => {
        const catName = i.category || "General / Tiffin";
        if (!categoryStats[catName]) {
          categoryStats[catName] = { count: 0, revenue: 0 };
        }
        categoryStats[catName].count += Number(i.qty || 1);
        categoryStats[catName].revenue += Number(i.price || 0) * Number(i.qty || 1);
      });
    }
  });

  const filteredOrders = orders.filter(o => {
    if (filterType === "ALL") return true;
    return o.order_type?.toLowerCase() === filterType.toLowerCase();
  });

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950 text-slate-100 p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Transactions & Logs</div>
          <h1 className="font-heading text-2xl font-bold text-white flex items-center gap-2">
            <Receipt className="h-6 w-6 text-teal-400" /> Orders History & Summary
          </h1>
        </div>
      </div>

      {/* --- TOTAL & TYPE SUMMARY CARDS --- */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider">Total Revenue</div>
          <div className="text-2xl font-bold text-teal-400 font-mono-pos mt-1">₹{totalRevenue.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{totalOrdersCount} Total Orders</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Utensils className="h-3.5 w-3.5 text-amber-400" /> Dine-In</div>
          <div className="text-2xl font-bold text-amber-400 font-mono-pos mt-1">₹{dineInRevenue.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{dineInCount} Orders</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><ShoppingBag className="h-3.5 w-3.5 text-blue-400" /> Takeaway</div>
          <div className="text-2xl font-bold text-blue-400 font-mono-pos mt-1">₹{takeawayRevenue.toFixed(2)}</div>
          <div className="text-xs text-slate-500 mt-1">{takeawayCount} Orders</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Coffee className="h-3.5 w-3.5 text-emerald-400" /> Categories Count</div>
          <div className="text-2xl font-bold text-emerald-400 font-mono-pos mt-1">{Object.keys(categoryStats).length} Active</div>
          <div className="text-xs text-slate-500 mt-1">Tiffin, Tea, Beverages & more</div>
        </div>
      </div>

      {/* --- CATEGORY BREAKDOWN PILLS --- */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-6">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">Category Wise Summary (Tiffin, Tea, Beverages)</div>
        <div className="flex flex-wrap gap-3">
          {Object.keys(categoryStats).map((cat) => (
            <div key={cat} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-sm font-medium text-slate-200">{cat}</span>
              <span className="text-xs font-mono-pos bg-teal-500/10 text-teal-300 px-2 py-0.5 rounded">
                Qty: {categoryStats[cat].count} | ₹{categoryStats[cat].revenue.toFixed(2)}
              </span>
            </div>
          ))}
          {Object.keys(categoryStats).length === 0 && (
            <div className="text-xs text-slate-500">No category breakdown available yet.</div>
          )}
        </div>
      </div>

      {/* --- FILTER BUTTONS & ORDERS TABLE --- */}
      <div className="flex gap-2 mb-4">
        {["ALL", "Dine-In", "Takeaway"].map((type) => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filterType === type ? "bg-teal-600 text-white" : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"}`}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-slate-900 border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-950 text-[10px] uppercase tracking-widest text-slate-400 sticky top-0">
            <tr>
              <th className="text-left px-4 py-3">Order #</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Items Summary</th>
              <th className="text-right px-4 py-3">Total Amount</th>
              <th className="text-center px-4 py-3">Payment</th>
              <th className="text-center px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Date & Time</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map((o) => (
              <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                <td className="px-4 py-3 font-mono-pos font-bold text-teal-300">{o.order_number}</td>
                <td className="px-4 py-3 text-slate-300">{o.order_type} {o.table_no ? `(${o.table_no})` : ""}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {Array.isArray(o.items) ? o.items.map(i => `${i.qty}x ${i.name}`).join(", ") : "-"}
                </td>
                <td className="px-4 py-3 text-right font-mono-pos text-emerald-400 font-bold">₹{Number(o.total).toFixed(2)}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-slate-800 text-slate-300">
                    {o.payment_mode}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${o.payment_status === "Paid" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                    {o.payment_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs font-mono-pos text-slate-400">
                  {new Date(o.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {filteredOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-12">No orders found in history.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}