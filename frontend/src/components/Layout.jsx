import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV_ITEMS = [
  { to: '/pulse', label: 'Churn Pulse' },
  { to: '/segments', label: 'Segments & Offers' },
  { to: '/forecast', label: 'Growth Forecast' },
  { to: '/trends', label: 'Product Trends' },
  { to: '/sentiment', label: 'Market Sentiment' },
  { to: '/complaints', label: 'Resolve' },
  { to: '/assistant', label: 'Assistant' },
  { to: '/blockchain', label: 'Audit Trail' },
];

export default function Layout({ children }) {
  const { role, branch, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-navy-dark border-r border-gold/10 p-4 flex flex-col">
        <div className="text-gold font-bold text-lg mb-6">ps_banks</div>
        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-gold/20 text-gold' : 'text-gray-300 hover:bg-white/5'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="text-xs text-gray-400 border-t border-white/10 pt-3">
          <div>{role} · {branch}</div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-2 text-gold hover:underline"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
