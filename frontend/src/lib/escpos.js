const ESC = 0x1b;
const GS = 0x1d;

const enc = (s) => Array.from(
  String(s ?? "").replace(/₹/g, "Rs.").normalize("NFKD").replace(/[^\x20-\x7E]/g, ""),
  (c) => c.charCodeAt(0),
);
const rs = (n) => Number(n || 0).toFixed(2);

export function buildReceipt(order, store, width = 80, withKot = false) {
  const cols = Number(width) === 58 ? 32 : 48;
  const out = [ESC, 0x40];
  const line = (s = "") => out.push(...enc(s), 0x0a);
  const align = (n) => out.push(ESC, 0x61, n);
  const bold = (on) => out.push(ESC, 0x45, on ? 1 : 0);
  const size = (n) => out.push(GS, 0x21, n);
  const hr = () => line("-".repeat(cols));
  const lr = (l, r) => {
    const right = String(r);
    const left = String(l).slice(0, Math.max(1, cols - right.length - 1));
    line(left + " ".repeat(Math.max(1, cols - left.length - right.length)) + right);
  };

  align(1); bold(true); size(0x11); line(store?.store_name || "RECEIPT"); size(0); bold(false);
  if (store?.address) line(store.address.slice(0, cols));
  if (store?.phone) line(`Ph: ${store.phone}`);
  if (store?.gst_number) line(`GSTIN: ${store.gst_number}`);
  align(0); hr();
  lr("Bill #", order.order_number);
  if (order.invoice_no) lr("Invoice #", order.invoice_no);
  lr("Date", new Date(order.created_at || Date.now()).toLocaleString("en-GB", { hour12: false }));
  lr("Type", order.order_type + (order.table_no ? ` / ${order.table_no}` : ""));
  hr();
  order.items.forEach((i) => {
    lr(`${i.qty} x ${i.name}`, rs(i.price * i.qty));
    if (i.notes) line(`  ${i.notes}`.slice(0, cols));
  });
  hr();
  lr("Subtotal", rs(order.subtotal));
  lr("GST", rs(order.tax));
  if (order.discount > 0) lr("Discount", `-${rs(order.discount)}`);
  bold(true); size(0x01); lr("TOTAL", `Rs.${rs(order.total)}`); size(0); bold(false);
  lr("Paid by", order.payment_mode);
  (order.splits || []).forEach((s) => lr(`  ${s.label} ${s.mode || "Due"}`, rs(s.amount)));
  hr(); align(1); line("Thank you! Visit again"); align(0);

  if (withKot) {
    line(); line(); align(1); bold(true); line("KITCHEN ORDER TICKET"); bold(false); align(0);
    lr("KOT #", order.order_number);
    lr("Time", new Date().toLocaleTimeString("en-GB", { hour12: false }));
    hr(); size(0x01);
    order.items.forEach((i) => line(`${i.qty} x ${i.name}${i.notes ? ` (${i.notes})` : ""}`.slice(0, cols)));
    size(0); hr();
  }
  out.push(0x0a, 0x0a, 0x0a, GS, 0x56, 0x42, 0x00);
  return new Uint8Array(out);
}
