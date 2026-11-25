import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Store, LogIn, Zap, ShieldCheck, FileText } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("demo123");
  const [loading, setLoading] = useState(false);
  const [legalModal, setLegalModal] = useState(null); // 'privacy' | 'terms' | null

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

        <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-center gap-4 text-[11px] text-slate-400">
          <button
            type="button"
            onClick={() => setLegalModal("privacy")}
            className="hover:text-teal-400 transition-colors underline-offset-4 hover:underline"
          >
            Privacy Policy
          </button>
          <span className="text-slate-700">•</span>
          <button
            type="button"
            onClick={() => setLegalModal("terms")}
            className="hover:text-teal-400 transition-colors underline-offset-4 hover:underline"
          >
            Terms & Conditions
          </button>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 text-[10px] text-slate-600 font-mono-pos uppercase tracking-widest">
        v1.0.0 · build 2026.02 · Flutter-desktop UI
      </div>

      {/* Privacy Policy Modal */}
      <Dialog open={legalModal === "privacy"} onOpenChange={(v) => !v && setLegalModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-400 text-lg font-heading">
              <ShieldCheck className="h-5 w-5" />
              Privacy Policy (தனியுரிமைக் கொள்கை)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-300 leading-relaxed mt-2">
            <div>
              <h3 className="font-semibold text-white text-base">Privacy Policy for Restaurant POS Software</h3>
              <p className="text-xs text-slate-400 mt-0.5">Effective Date: November 25, 2026</p>
            </div>
            <p>
              We respect your privacy and are committed to protecting the data of your restaurant, staff, and customers. This Privacy Policy explains how our POS software collects, uses, and safeguards your information.
            </p>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">1. Information We Collect:</h4>
              <ul className="list-disc pl-5 space-y-1 text-slate-300">
                <li><strong className="text-slate-200">Restaurant Details:</strong> Business name, owner name, FSSAI license, GSTIN, phone number, and email address.</li>
                <li><strong className="text-slate-200">Operational Data:</strong> Menu items, pricing, inventory stock levels, tables, and daily sales/billing transactions.</li>
                <li><strong className="text-slate-200">Customer Data:</strong> Names and phone numbers collected strictly for billing, receipts, or loyalty purposes.</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">2. How We Use Your Information:</h4>
              <ul className="list-disc pl-5 space-y-1 text-slate-300">
                <li>To process orders, manage inventory, and generate GST-compliant billing receipts.</li>
                <li>To integrate with authorized third-party delivery partners (such as Swiggy/Zomato via APIs) only upon your explicit authorization.</li>
                <li>To provide technical support, updates, and system notifications.</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">3. Data Security:</h4>
              <p>
                We use secure cloud databases (encrypted in transit and at rest) to ensure your sales and financial data remain confidential. We never sell, rent, or share your business data with unauthorized third parties.
              </p>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">4. Contact Us:</h4>
              <p>
                If you have any questions regarding this Privacy Policy, you can contact our support team.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Terms & Conditions Modal */}
      <Dialog open={legalModal === "terms"} onOpenChange={(v) => !v && setLegalModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-teal-400 text-lg font-heading">
              <FileText className="h-5 w-5" />
              Terms & Conditions (நிபந்தனைகள் மற்றும் கட்டுப்பாடுகள்)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm text-slate-300 leading-relaxed mt-2">
            <div>
              <h3 className="font-semibold text-white text-base">Terms & Conditions for Restaurant POS Software</h3>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">1. Acceptance of Terms:</h4>
              <p>
                By accessing or using our Restaurant POS software, you agree to be bound by these Terms & Conditions. If you do not agree, please do not use the software.
              </p>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">2. Software License & Usage:</h4>
              <ul className="list-disc pl-5 space-y-1 text-slate-300">
                <li>We grant you a non-exclusive, non-transferable license to use the POS software for your restaurant operations.</li>
                <li>You are solely responsible for maintaining the confidentiality of your login credentials and password.</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">3. Third-Party Services (Swiggy, Zomato, UrbanPiper, etc.):</h4>
              <ul className="list-disc pl-5 space-y-1 text-slate-300">
                <li>Our software may support integrations with third-party aggregators. We are not responsible for downtime, payment delays, commission policies, or policy changes enforced by third-party delivery platforms.</li>
                <li>Restaurant owners must comply with respective aggregator terms when linking their accounts.</li>
              </ul>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">4. Data Accuracy & Billing:</h4>
              <p>
                The software assists in generating bills and tax calculations based on input data. The restaurant owner is entirely responsible for verifying menu prices, tax rates, and regulatory filings (GST/FSSAI).
              </p>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">5. Limitation of Liability:</h4>
              <p>
                We strive to provide uninterrupted service, but we shall not be held liable for temporary server downtimes, internet connection failures, or data loss arising from improper device usage.
              </p>
            </div>
            <div className="space-y-1.5">
              <h4 className="font-semibold text-teal-300">6. Modifications:</h4>
              <p>
                We reserve the right to update these terms at any time, and continued use of the software constitutes your acceptance of the updated terms.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}