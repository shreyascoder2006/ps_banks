import {
  Activity, BellRing, FlaskConical, LayoutDashboard, Landmark, Languages, LineChart, LogOut, Megaphone, MessagesSquare,
  ShieldCheck, Sparkles, TrendingUp, Users, X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../lib/useApi';
import ChatWidget from './ChatWidget';
import TopBar from './TopBar';

const NAV_GROUPS = [
  {
    label: 'Retention',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/alerts', label: 'Early Warning', icon: BellRing, badge: true },
      { to: '/pulse', label: 'Churn Pulse', icon: Activity },
      { to: '/outreach', label: 'Outreach', icon: Megaphone },
      { to: '/scenarios', label: 'Scenario Studio', icon: FlaskConical },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/segments', label: 'Segments & Offers', icon: Users },
      { to: '/forecast', label: 'Growth Forecast', icon: TrendingUp },
      { to: '/trends', label: 'Product Trends', icon: LineChart },
      { to: '/sentiment', label: 'Market Sentiment', icon: Sparkles },
    ],
  },
  {
    label: 'Service & Compliance',
    items: [
      { to: '/complaints', label: 'Resolve', icon: MessagesSquare },
      { to: '/assistant', label: 'Policy Assistant', icon: Sparkles },
      { to: '/frontline', label: 'Frontline Assist', icon: Languages },
      { to: '/blockchain', label: 'Audit Trail', icon: ShieldCheck },
    ],
  },
];

function Sidebar({ onNavigate }) {
  const { role, branch, logout } = useAuth();
  const navigate = useNavigate();
  const summary = useApi('/alerts/summary', { refreshMs: 20000 });
  const open = summary.data?.open ?? 0;

  return (
    <div className="h-full flex flex-col bg-navy-dark/95 border-r border-white/[0.06]">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-6">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gold-light to-gold flex items-center justify-center shadow-glow">
          <Landmark size={18} className="text-navy-dark" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <div>
          <div className="text-white font-bold text-[15px] leading-tight tracking-tight">Bank Pulse</div>
          <div className="text-[10px] text-gray-500 leading-tight tracking-wide uppercase">Retention intelligence</div>
        </div>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-3 space-y-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1 text-[10px] uppercase tracking-[0.14em] text-gray-600 font-semibold">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors duration-150 relative ${
                        isActive ? 'bg-gold/[0.12] text-gold' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />}
                        <Icon size={16} strokeWidth={2} aria-hidden="true" className={isActive ? 'text-gold' : 'text-gray-500 group-hover:text-gray-300'} />
                        <span className="flex-1">{item.label}</span>
                        {item.badge && open > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-risk-critical/90 text-white text-[10px] font-bold flex items-center justify-center" aria-label={`${open} open alerts`}>
                            {open}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mx-3 mb-3 px-3 py-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold/40 to-gold/10 flex items-center justify-center text-gold text-xs font-bold uppercase">
            {role?.[0] || '?'}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white capitalize truncate">{role}</div>
            <div className="text-[11px] text-gray-500 truncate">{branch}</div>
          </div>
        </div>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-gold py-1.5 rounded-md hover:bg-white/[0.04] transition-colors"
        >
          <LogOut size={12} aria-hidden="true" /> Log out
        </button>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-screen flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn-primary px-3 py-2 text-sm">Skip to content</a>

      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen"><Sidebar /></aside>

      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="w-72 max-w-[85vw] h-full panel-enter relative">
            <Sidebar onNavigate={() => setDrawer(false)} />
            <button onClick={() => setDrawer(false)} className="absolute top-4 right-3 p-1.5 text-gray-400 hover:text-white" aria-label="Close navigation"><X size={18} /></button>
          </div>
          <button className="flex-1 bg-black/60" onClick={() => setDrawer(false)} aria-label="Close navigation overlay" />
        </div>
      )}

      <main id="main" className="flex-1 min-w-0">
        <TopBar onMenu={() => setDrawer(true)} />
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 fade-in">{children}</div>
      </main>
      <ChatWidget />
    </div>
  );
}
