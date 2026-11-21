import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Store, LogIn, Zap } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("demo123");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(username, password);
      toast.success("Login successful");
      nav("/", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-950 relative overflow-hidden">
      {/* Grid backdrop */}
      <div className="absolute inset-0 opacity-[0.08]"
           style={{backgroundImage:'linear-gradient(#2dd4bf 1px, transparent 1px), linear-gradient(90deg, #2dd4bf 1px, transparent 1px)',backgroundSize:'44px 44px'}} />
      <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-teal-500/20 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />

      <div className="relative z-10 w-[440px] bg-slate-900/80 border border-slate-800 backdrop-blur-xl rounded-xl shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/30">
            <Store className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-teal-400 font-semibold">Multi-tenant SaaS POS</div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-white">Spice Terminal</h1>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Store Username</Label>
            <Input
              value={username} onChange={(e) => setUsername(e.target.value)}
              data-testid="login-username" autoFocus
              className="mt-1 bg-slate-950 border-slate-800 text-slate-100 h-11 font-mono-pos"
              placeholder="demo" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-400">Password</Label>
            <Input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              className="mt-1 bg-slate-950 border-slate-800 text-slate-100 h-11 font-mono-pos"
              placeholder="••••••••" />
          </div>
          <Button
            type="submit" disabled={loading} data-testid="login-submit-btn"
            className="w-full h-11 bg-teal-600 hover:bg-teal-500 text-white font-semibold tracking-wide">
            <LogIn className="h-4 w-4 mr-2" />
            {loading ? "SIGNING IN..." : "SIGN IN TO TERMINAL"}
          </Button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-800 flex items-start gap-2 text-xs text-slate-500">
          <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>Demo credentials prefilled. Multi-store login (one URL, infinite tenants).</div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 text-[10px] text-slate-600 font-mono-pos uppercase tracking-widest">
        v1.0.0 · build 2026.02 · Flutter-desktop UI
      </div>
    </div>
  );
}
