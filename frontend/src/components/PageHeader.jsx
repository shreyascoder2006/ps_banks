import React from 'react';

export default function PageHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-7">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
            <Icon size={19} className="text-gold" strokeWidth={2} />
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-gray-500 mt-0.5 max-w-2xl">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
