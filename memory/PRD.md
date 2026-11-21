# PRD: Spice Terminal, a Multi-Tenant Restaurant POS

## Original Problem
A multi-tenant SaaS restaurant billing POS (originally specified as a Flutter Windows app with PostgreSQL/Render). Requirements: UrbanPiper (Swiggy/Zomato) integration, Razorpay/PhonePe UPI QR, card and cash payments, and thermal receipt + KOT printing.

## User Choices
- React web POS with a Flutter/Fluent Windows desktop look (FastAPI + MongoDB)
- Razorpay UPI QR + webhook; UrbanPiper MOCKED (the incoming webhook is real; outbound sync is only logged)
- Printing via the browser print dialog (80mm layout); store login with username/password (JWT)

## Architecture
- Backend: /app/backend/server.py (FastAPI, Motor, bcrypt + PyJWT, one WebSocket channel per store)
- Frontend: /app/frontend/src/pages/* (Login, Shell, Dashboard, PosBilling, PaymentModal, ReceiptPrint, HeldOrdersDialog, TablesFloor, OnlineOrders, MenuManager, OrdersHistory, Reports, Settings)

## Implemented
- 2026-06 MVP: store login, POS billing, Cash/Card/UPI QR payments, Razorpay + UrbanPiper webhooks, online orders with sound alerts and auto-accept, stock toggle, dashboard, order history, settings, 80mm receipt + KOT
- 2026-06 Iteration 2:
  - Daily Sales Report (/reports): GST split by rate with CGST/SGST, payment modes, channels, top items and order list; date picker; CSV export (/api/reports/daily/csv)
  - Table Floor (/tables): tables shown as Free/Occupied/Billed with running bill and time open; add/delete tables; tap a table to open or recall its bill, or pay a billed table
  - Hold orders: park a bill (linked to its table when Dine-In) and recall it from the Held dialog; shortcuts F2 pay, F4 hold, F8 reprint last receipt, F3 / Ctrl+/ search
  - Fixes: double-payment guard; table can't hold two parked bills; validation and 404s; GST calculated after discount; paid POS orders can't be cancelled; item images matched; fewer duplicate toasts
- 2026-06 Iteration 3:
  - Split bills: equal split (2-10 guests, exact to the paise) or by item (per-unit guest assignment, discount-aware); each share collected by Cash/Card/UPI QR; order goes Partial → Paid; undo before any share is paid; split lines printed on the receipt
  - Move / merge tables: move to a free table, or merge into a busy one (same items' qty combined; open bills moved); merge needs confirmation
  - Monthly GST (/reports/monthly): GSTR-3B 3.1(a) + 3.1.1(ii) for aggregator orders u/s 9(5), GSTR-1 B2CS, HSN (SAC 996331), documents issued, aggregator (e-commerce operator) table, day-wise sales; accountant CSV + GST offline-tool CSVs (b2cs/hsn/docs)
  - Gap-free POS invoice series INV###### assigned on full payment (atomic counter + one-time claim per order; backfilled on startup); safe against concurrent payments

## Mocked
- UrbanPiper outbound sync (logged only)
- Razorpay UPI: DEMO_PAYMENT_MODE=true marks payments paid automatically after about 12 seconds

## Backlog
- P0: Live Razorpay keys (DEMO_PAYMENT_MODE=false); real UrbanPiper API calls
- P1: Item-level discounts in the UI, refunds for paid orders, B2B invoices with customer GSTIN (GSTR-1 B2B)
- P1: Date-range reports (weekly/monthly), GSTR-1 style export
- P2: Staff roles/PIN login, inventory, PhonePe gateway
