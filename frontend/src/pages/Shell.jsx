import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, ShoppingCart, Flame, Boxes, Receipt, Settings as SettingsIcon,
  LogOut, Volume2, VolumeX, Minus, Square, X, Wifi, WifiOff, Store,
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/pos", label: "POS Billing", icon: ShoppingCart, testid: "nav-pos" },
  { to: "/online", label: "Online Orders", icon: Flame, testid: "nav-online" },
  { to: "/menu", label: "Menu & Stock", icon: Boxes, testid: "nav-menu" },
  { to: "/orders", label: "Orders History", icon: Receipt, testid: "nav-orders" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testid: "nav-settings" },
];

export default function Shell() {
  const { store, logout, wsConnected, subscribe } = useAuth();
  const nav = useNavigate();
  const [clock, setClock] = useState(new Date());
  const [muted, setMuted] = useState(() => localStorage.getItem("pos_muted") === "1");
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === "online_order") {
        setOnlineCount((c) => c + 1);
        toast(`${msg.channel} order: ${msg.order.order_number}`, {
          description: `₹${msg.order.total.toFixed(2)} · ${msg.order.items.length} items`,
        });
        if (!muted) {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = 880; g.gain.value = 0.08;
            o.start(); setTimeout(() => { o.frequency.value = 1240; }, 180);
            setTimeout(() => { o.stop(); ctx.close(); }, 420);
          } catch {}
        }
      }
      if (msg.type === "payment_success") {
        toast.success(`Payment received · ${msg.mode}`);
      }
    });
  }, [subscribe, muted]);

  const doLogout = () => { logout(); nav("/login"); };
  const toggleMute = () => { const n = !muted; setMuted(n); localStorage.setItem("pos_muted", n ? "1" : "0"); };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Window chrome header */}
      <div className="h-10 bg-slate-950 border-b border-slate-800/80 flex items-center px-3 shrink-0" data-testid="window-header">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
            <Store className="h-3 w-3 text-white" />
          </div>
          <span className="font-heading text-[11px] font-bold tracking-widest uppercase text-slate-300">
            Spice Terminal
          </span>
          <span className="text-slate-700">·</span>
          <span className="text-[11px] text-slate-500 font-mono-pos" data-testid="window-store-name">
            {store?.store_name}
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-[11px]">
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${wsConnected ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400" : "bg-rose-500/10 border-rose-500/40 text-rose-400"}`}
               data-testid="ws-status">
            <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-emerald-400 pulse-dot" : "bg-rose-400"}`} />
            {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span className="font-mono-pos tracking-wider">{wsConnected ? "LIVE" : "OFFLINE"}</span>
          </div>
          <button onClick={toggleMute} className="h-6 w-6 rounded hover:bg-slate-800 flex items-center justify-center text-slate-400"
                  data-testid="header-mute-toggle" title={muted ? "Unmute alerts" : "Mute alerts"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <span className="font-mono-pos text-slate-400 tracking-wider" data-testid="header-clock">
            {clock.toLocaleTimeString("en-GB", { hour12: false })}
          </span>
          <div className="flex items-center gap-0.5 ml-2">
            <button className="h-6 w-6 rounded hover:bg-slate-800 flex items-center justify-center text-slate-500"><Minus className="h-3 w-3" /></button>
            <button className="h-6 w-6 rounded hover:bg-slate-800 flex items-center justify-center text-slate-500"><Square className="h-2.5 w-2.5" /></button>
            <button className="h-6 w-6 rounded hover:bg-rose-600/80 flex items-center justify-center text-slate-500 hover:text-white"><X className="h-3 w-3" /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
          <nav className="flex-1 p-2 space-y-0.5">
            {navItems.map(({ to, label, icon: Icon, testid }) => (
              <NavLink key={to} to={to} data-testid={testid}
                className={({ isActive }) => `flex items-center gap-3 px-3 h-10 rounded-md text-[13px] font-medium transition ${isActive
                  ? "bg-teal-500/10 text-teal-300 border-l-2 border-teal-400"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border-l-2 border-transparent"}`}>
                <Icon className="h-4 w-4" />
                <span className="flex-1">{label}</span>
                {to === "/online" && onlineCount > 0 && (
                  <span className="text-[10px] font-bold font-mono-pos bg-rose-500 text-white px-1.5 py-0.5 rounded">{onlineCount}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="p-2 border-t border-slate-800">
            <button onClick={doLogout} data-testid="nav-logout"
              className="w-full flex items-center gap-3 px-3 h-10 rounded-md text-[13px] text-slate-400 hover:text-rose-400 hover:bg-rose-500/10">
              <LogOut className="h-4 w-4" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-hidden bg-slate-950">
          <Outlet context={{ clearOnlineCount: () => setOnlineCount(0) }} />
        </main>
      </div>
    </div>
  );
}
