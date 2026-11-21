import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import "@/index.css";
import "@/App.css";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import Shell from "@/pages/Shell";
import Dashboard from "@/pages/Dashboard";
import PosBilling from "@/pages/PosBilling";
import OnlineOrders from "@/pages/OnlineOrders";
import MenuManager from "@/pages/MenuManager";
import OrdersHistory from "@/pages/OrdersHistory";
import Settings from "@/pages/Settings";
import TablesFloor from "@/pages/TablesFloor";
import Reports from "@/pages/Reports";
import MonthlyGst from "@/pages/MonthlyGst";
import QuickPos from "@/pages/QuickPos";
import Reconciliation from "@/pages/Reconciliation";

function HomeRedirect() {
  const { store } = useAuth();
  const quick = store?.business_type && store.business_type !== "Restaurant";
  return <Navigate to={quick ? "/quick" : "/pos"} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function RequireAuth({ children }) {
  const { token } = useAuth();
  const loc = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<HomeRedirect />} />
        <Route path="quick" element={<QuickPos />} />
        <Route path="reports/reconciliation" element={<Reconciliation />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="pos" element={<PosBilling />} />
        <Route path="online" element={<OnlineOrders />} />
        <Route path="menu" element={<MenuManager />} />
        <Route path="orders" element={<OrdersHistory />} />
        <Route path="settings" element={<Settings />} />
        <Route path="tables" element={<TablesFloor />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/monthly" element={<MonthlyGst />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="bottom-center" theme="dark" richColors closeButton />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);
