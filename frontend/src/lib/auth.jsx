import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { api, wsUrl } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [store, setStore] = useState(() => {
    const s = localStorage.getItem("pos_store");
    return s ? JSON.parse(s) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem("pos_token"));
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const listenersRef = useRef(new Set());

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post("/auth/login", { username, password });
    localStorage.setItem("pos_token", data.token);
    localStorage.setItem("pos_store", JSON.stringify(data.store));
    setToken(data.token);
    setStore(data.store);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("pos_token");
    localStorage.removeItem("pos_store");
    setToken(null);
    setStore(null);
    if (wsRef.current) wsRef.current.close();
  };

  useEffect(() => {
    if (!token) {
      setWsConnected(false);
      return;
    }
    const ws = new WebSocket(wsUrl(token));
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        listenersRef.current.forEach((fn) => fn(msg));
      } catch {}
    };
    const ping = setInterval(() => {
      if (ws.readyState === 1) ws.send("ping");
    }, 25000);
    return () => {
      clearInterval(ping);
      ws.close();
    };
  }, [token]);

  return (
    <AuthCtx.Provider value={{ store, token, login, logout, wsConnected, subscribe, setStore }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
