import React, { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Store as StoreIcon, Key, Link2 } from "lucide-react";

const Section = ({ icon: Icon, title, children }) => (
  <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-4">
    <div className="flex items-center gap-2 mb-4"><Icon className="h-4 w-4 text-teal-400" />
      <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-slate-200">{title}</h3>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field = ({ label, name, data, setData, type = "text", testid, placeholder }) => (
  <div>
    <Label className="text-xs uppercase tracking-wider text-slate-400">{label}</Label>
    <Input type={type} value={data[name] || ""} placeholder={placeholder}
      onChange={(e) => setData({ ...data, [name]: e.target.value })}
      data-testid={testid} className="mt-1 bg-slate-950 border-slate-800 text-slate-100 font-mono-pos h-10" />
  </div>
);

export default function Settings() {
  const { store, setStore } = useAuth();
  const [data, setData] = useState(store || {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/stores/me", data);
      const { data: me } = await api.get("/auth/me");
      setStore(me); localStorage.setItem("pos_store", JSON.stringify(me));
      toast.success("Store settings saved");
    } catch (e) { toast.error("Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold">Tenant · {store?.username}</div>
          <h1 className="font-heading text-2xl font-bold text-white">Store Settings</h1>
        </div>

        <Section icon={StoreIcon} title="Store profile">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Store name" name="store_name" data={data} setData={setData} testid="set-store-name" />
            <Field label="Phone" name="phone" data={data} setData={setData} testid="set-phone" />
            <Field label="GST Number" name="gst_number" data={data} setData={setData} testid="set-gst" />
            <Field label="UPI VPA" name="upi_vpa" data={data} setData={setData} testid="set-upi-vpa" placeholder="merchant@upi" />
          </div>
          <Field label="Address" name="address" data={data} setData={setData} testid="set-address" />
        </Section>

        <Section icon={Link2} title="UrbanPiper">
          <div className="grid grid-cols-2 gap-3">
            <Field label="UrbanPiper Store ID" name="urbanpiper_store_id" data={data} setData={setData} testid="set-up-store-id" />
            <Field label="UrbanPiper API Key" name="urbanpiper_api_key" data={data} setData={setData} testid="set-up-api-key" type="password" />
          </div>
          <div className="text-xs text-slate-500">Webhook URL: <span className="font-mono-pos text-teal-400">{process.env.REACT_APP_BACKEND_URL}/api/webhooks/urbanpiper</span></div>
        </Section>

        <Section icon={Key} title="Razorpay (UPI/Card)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Razorpay Key ID" name="razorpay_key_id" data={data} setData={setData} testid="set-rzp-key" />
            <Field label="Razorpay Key Secret" name="razorpay_key_secret" data={data} setData={setData} testid="set-rzp-secret" type="password" />
          </div>
          <div className="text-xs text-slate-500">Webhook URL: <span className="font-mono-pos text-teal-400">{process.env.REACT_APP_BACKEND_URL}/api/webhooks/razorpay</span></div>
          <div className="text-xs text-amber-400">Demo mode is ON: UPI QR auto-confirms in ~12s. Add live keys and set DEMO_PAYMENT_MODE=false to go live.</div>
        </Section>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} data-testid="settings-save-btn"
            className="bg-teal-600 hover:bg-teal-500 h-11 px-6 font-semibold tracking-wide">
            {saving ? "SAVING..." : "SAVE SETTINGS"}
          </Button>
        </div>
      </div>
    </div>
  );
}
