import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const RealtimeContext = createContext(null);
const ALERT_TYPES = new Set(['sla_breached', 'sla_warning', 'risk_changed', 'balance_moved', 'complaint_logged', 'outreach_outcome', 'audit_failed', 'simulation_error']);
const WS_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/^http/, 'ws');

export function RealtimeProvider({ children }) {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [simulation, setSimulation] = useState({ running: false });
  const listeners = useRef(new Set());
  const wsRef = useRef(null);
  const retryRef = useRef(1000);

  const dispatch = useCallback((event) => {
    listeners.current.forEach((fn) => { try { fn(event); } catch { /* listener errors never break the stream */ } });
  }, []);

  useEffect(() => {
    let closed = false;
    if (!token) { setConnected(false); return undefined; }
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${WS_BASE}/ws/events?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); retryRef.current = 1000; };
      ws.onmessage = (msg) => {
        const event = JSON.parse(msg.data);
        if (event.type === 'ping') return;
        if (event.type === 'hello') {
          setSimulation(event.data.simulation);
          setEvents(event.data.recent || []);
          return;
        }
        if (event.type === 'simulation') setSimulation((s) => ({ ...s, running: event.data.running }));
        setEvents((prev) => [event, ...prev].slice(0, 200));
        if (ALERT_TYPES.has(event.type) && ['critical', 'high', 'medium'].includes(event.severity)) {
          setAlerts((prev) => [{ ...event, id: `${event.at}-${Math.random()}`, read: false }, ...prev].slice(0, 50));
        }
        dispatch(event);
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        setTimeout(connect, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 15000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => { closed = true; wsRef.current?.close(); };
  }, [dispatch, token]);

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const toggleSimulation = useCallback(async () => {
    const res = simulation.running
      ? await client.post('/simulation/stop')
      : await client.post('/simulation/start', null, { params: { speed: 1.5 } });
    setSimulation(res.data);
  }, [simulation.running]);

  const markAllRead = useCallback(() => setAlerts((a) => a.map((x) => ({ ...x, read: true }))), []);
  const clearAlerts = useCallback(() => setAlerts([]), []);

  const value = useMemo(() => ({
    events, alerts, unread: alerts.filter((a) => !a.read).length, connected, simulation,
    subscribe, toggleSimulation, markAllRead, clearAlerts,
  }), [events, alerts, connected, simulation, subscribe, toggleSimulation, markAllRead, clearAlerts]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Subscribe a page to live events. `filter` is a type prefix, array of types, or predicate. */
export function useEvent(filter, handler) {
  const rt = useContext(RealtimeContext);
  const saved = useRef(handler);
  useEffect(() => { saved.current = handler; }, [handler]);
  useEffect(() => {
    if (!rt) return undefined;
    const match = typeof filter === 'function' ? filter
      : Array.isArray(filter) ? (e) => filter.includes(e.type)
      : (e) => e.type.startsWith(filter);
    return rt.subscribe((e) => { if (match(e)) saved.current(e); });
  }, [rt, filter]);
}
