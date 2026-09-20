import { Bell, Check, Radio, Trash2, Wifi, WifiOff } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtime } from '../lib/realtime';
import { useToast } from './Toast';

const SEV = {
  critical: 'text-risk-critical bg-risk-critical/10 border-risk-critical/20',
  high: 'text-risk-high bg-risk-high/10 border-risk-high/20',
  medium: 'text-risk-medium bg-risk-medium/10 border-risk-medium/20',
  low: 'text-risk-low bg-risk-low/10 border-risk-low/20',
};

function targetFor(alert) {
  if (alert.ref?.complaintId) return '/complaints';
  if (alert.ref?.customerId) return `/customers/${alert.ref.customerId}`;
  if (alert.ref?.actionId) return '/outreach';
  return '/';
}

export default function TopBar() {
  const rt = useRealtime();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const lastToastAt = useRef(0);

  // Surface critical/high alerts as toasts (throttled so a burst doesn't spam).
  useEffect(() => {
    if (!rt) return undefined;
    return rt.subscribe((e) => {
      if (!['critical', 'high'].includes(e.severity)) return;
      const now = Date.now();
      if (now - lastToastAt.current < 2500) return;
      lastToastAt.current = now;
      toast(e.title, e.severity === 'critical' ? 'error' : 'info', 4500);
    });
  }, [rt, toast]);

  useEffect(() => {
    const onClick = (ev) => { if (panelRef.current && !panelRef.current.contains(ev.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!rt) return null;
  const { alerts, unread, connected, simulation, toggleSimulation, markAllRead, clearAlerts } = rt;

  return (
    <div className="sticky top-0 z-40 flex items-center justify-end gap-3 px-8 py-3 bg-navy/70 backdrop-blur-md border-b border-white/[0.04]">
      <button
        onClick={toggleSimulation}
        data-tour="live-toggle"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
          simulation.running ? 'bg-risk-low/10 border-risk-low/30 text-risk-low' : 'bg-white/[0.04] border-white/10 text-gray-400 hover:text-gray-200'
        }`}
        title={simulation.running ? 'Stop live demo mode' : 'Start live demo mode — simulates bank events in real time'}
      >
        <span className={`w-2 h-2 rounded-full ${simulation.running ? 'bg-risk-low animate-pulse' : 'bg-gray-600'}`} />
        <Radio size={13} /> {simulation.running ? 'Live demo running' : 'Live demo mode'}
      </button>

      <span className={`flex items-center gap-1 text-[11px] ${connected ? 'text-risk-low' : 'text-gray-500'}`} title={connected ? 'Real-time connected' : 'Reconnecting…'}>
        {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
      </span>

      <div className="relative" ref={panelRef}>
        <button onClick={() => { setOpen((o) => !o); if (!open) markAllRead(); }} data-tour="alerts" className="relative p-2 rounded-lg hover:bg-white/[0.05] text-gray-300">
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-risk-critical text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-[420px] card shadow-glow fade-in overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <span className="kicker">Alerts ({alerts.length})</span>
              <div className="flex gap-2">
                <button onClick={markAllRead} className="text-xs text-gray-400 hover:text-white flex items-center gap-1"><Check size={12} /> Read</button>
                <button onClick={clearAlerts} className="text-xs text-gray-400 hover:text-white flex items-center gap-1"><Trash2 size={12} /> Clear</button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {alerts.length === 0 ? (
                <p className="p-6 text-sm text-gray-500 text-center">No alerts yet. Turn on live demo mode to see the bank move.</p>
              ) : alerts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { navigate(targetFor(a)); setOpen(false); }}
                  className={`w-full text-left px-4 py-3 border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors ${a.read ? '' : 'bg-gold/[0.04]'}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`badge border shrink-0 mt-0.5 ${SEV[a.severity] || SEV.medium}`}>{a.severity}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-200 leading-snug">{a.title}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{a.type.replace('_', ' ')} · {new Date(a.at).toLocaleTimeString()}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
