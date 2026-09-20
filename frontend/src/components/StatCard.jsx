import React from 'react';

export default function StatCard({ label, value, sub, icon: Icon, tone = 'gold' }) {
  const toneClasses = {
    gold: 'text-gold bg-gold/10 border-gold/20',
    green: 'text-risk-low bg-risk-low/10 border-risk-low/20',
    red: 'text-risk-critical bg-risk-critical/10 border-risk-critical/20',
    blue: 'text-risk-medium bg-risk-medium/10 border-risk-medium/20',
  }[tone];

  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</div>
          <div className="text-2xl font-bold text-white tabular-nums tracking-tight">{value}</div>
          {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
        </div>
        {Icon && (
          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${toneClasses}`}>
            <Icon size={16} strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  );
}
