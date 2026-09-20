import {
  Activity, LayoutDashboard, Landmark, LineChart, LogOut, Megaphone, MessagesSquare,
  ShieldCheck, Sparkles, TrendingUp, Users,
} from 'lucide-react';
import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/pulse', label: 'Churn Pulse', icon: Activity },
  { to: '/outreach', label: 'Outreach', icon: Megaphone },
  { to: '/segments', label: 'Segments & Offers', icon: Users },
  { to: '/forecast', label: 'Growth Forecast', icon: TrendingUp },
  { to: '/trends', label: 'Product Trends', icon: LineChart },
  { to: '/sentiment', label: 'Market Sentiment', icon: Sparkles },
  { to: '/complaints', label: 'Resolve', icon: MessagesSquare },
  { to: '/assistant', label: 'Assistant', icon: Sparkles },
  { to: '/blockchain', label: 'Audit Trail', icon: ShieldCheck },
];

export default function Layout({ children }) {
  const { role, branch, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 bg-navy-dark/60 border-r border-white/[0.06] flex flex-col">
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold-light to-gold flex items-center justify-center shadow-glow">
            <Landmark size={17} className="text-navy-dark" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-white font-bold text-[15px] leading-tight tracking-tight">ps_banks</div>
            <div className="text-[10px] text-gray-500 leading-tight tracking-wide uppercase">Intelligence console</div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all duration-150 relative ${
                    isActive
                      ? 'bg-gold/[0.12] text-gold'
                      : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />}
                    <Icon size={16} strokeWidth={2} className={isActive ? 'text-gold' : 'text-gray-500 group-hover:text-gray-300'} />
                    {item.label}
                  </>
                )}
              </NavLink>
            );
          })}
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
            <LogOut size={12} /> Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8 fade-in">{children}</div>
      </main>
    </div>
  );
}
