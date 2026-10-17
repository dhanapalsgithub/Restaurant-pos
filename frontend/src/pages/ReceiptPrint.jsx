import React from "react";

export default function ReceiptPrint({ order, store }) {
  if (!order) return null;
  return (
    <div className="thermal-receipt" data-testid="thermal-receipt-print">
      <div className="center">
        <div style={{ fontWeight: 800, fontSize: 14 }}>{store?.store_name || "RESTAURANT"}</div>
        <div>{store?.address}</div>
        <div>Ph: {store?.phone}</div>
        {store?.gst_number && <div>GSTIN: {store.gst_number}</div>}
      </div>
      <hr />
      <div className="row"><span>Bill #</span><span>{order.order_number}</span></div>
      {order.invoice_no && <div className="row"><span>Invoice #</span><span>{order.invoice_no}</span></div>}
      <div className="row"><span>Type</span><span>{order.order_type}</span></div>
      <div className="row"><span>Date</span><span>{new Date(order.created_at || Date.now()).toLocaleString()}</span></div>
      {order.table_no && <div className="row"><span>Table</span><span>{order.table_no}</span></div>}
      <hr />
      <div style={{ fontWeight: 700 }}>Item                  Qty  Amt</div>
      {order.items.map((i, idx) => (
        <div key={idx} className="row">
          <span>{i.name.slice(0, 18).padEnd(18)} x{i.qty}</span>
          <span>₹{(i.price * i.qty).toFixed(2)}</span>
        </div>
      ))}
      <hr />
      <div className="row"><span>Subtotal</span><span>₹{order.subtotal?.toFixed(2)}</span></div>
      <div className="row"><span>Tax (GST)</span><span>₹{order.tax?.toFixed(2)}</span></div>
      {order.discount > 0 && <div className="row"><span>Discount</span><span>-₹{order.discount.toFixed(2)}</span></div>}
      <div className="row" style={{ fontWeight: 800, fontSize: 14 }}>
        <span>TOTAL</span><span>₹{order.total?.toFixed(2)}</span>
      </div>
      <hr />
      <div className="row"><span>Payment</span><span>{order.payment_mode}</span></div>
      {order.splits?.length > 0 && order.splits.map((s) => (
        <div key={s.id} className="row"><span>  {s.label} · {s.mode || "Due"}</span><span>₹{s.amount.toFixed(2)}</span></div>
      ))}
      {order.payment_ref && <div className="row"><span>Ref</span><span>{order.payment_ref}</span></div>}
      <hr />
      <div className="center">** Thank you · Visit again **</div>
      <div className="center" style={{ marginTop: 6 }}>-- KITCHEN ORDER TICKET --</div>
      <div className="row"><span>KOT #</span><span>{order.order_number}</span></div>
      <div className="row"><span>Time</span><span>{new Date().toLocaleTimeString()}</span></div>
      <hr />
      {order.items.map((i, idx) => (
        <div key={idx} style={{ fontSize: 13 }}>{i.qty} x {i.name}{i.notes ? ` (${i.notes})` : ""}</div>
      ))}
      <hr />
      <div className="center">-- END --</div>
    </div>
  );
}
