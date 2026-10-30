import { ChevronRight } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

export default function PageHeader({ icon: Icon, title, subtitle, action, crumbs }) {
  return (
    <header className="mb-6">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] text-gray-500 mb-2">
          {crumbs.map((c, i) => (
            <React.Fragment key={c.label}>
              {i > 0 && <ChevronRight size={11} aria-hidden="true" />}
              {c.to ? <Link to={c.to} className="hover:text-gold">{c.label}</Link> : <span className="text-gray-400">{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
              <Icon size={19} className="text-gold" strokeWidth={2} aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
            {subtitle && <p className="text-[13px] text-gray-500 mt-0.5 max-w-2xl">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}
