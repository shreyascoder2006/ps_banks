import React from 'react';

const RISK_STYLES = {
  critical: 'bg-risk-critical/15 text-risk-critical border-risk-critical/20',
  high: 'bg-risk-high/15 text-risk-high border-risk-high/20',
  medium: 'bg-risk-medium/15 text-risk-medium border-risk-medium/20',
  low: 'bg-risk-low/15 text-risk-low border-risk-low/20',
};

export function RiskBadge({ level, children }) {
  return (
    <span className={`badge border ${RISK_STYLES[level] || RISK_STYLES.medium}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Spinner({ size = 16, className = 'text-gold' }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SourceTag({ source }) {
  const live = source === 'live';
  return (
    <span className={`badge ${live ? 'bg-risk-low/15 text-risk-low' : 'bg-gray-500/15 text-gray-400'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-risk-low animate-pulse' : 'bg-gray-500'}`} />
      {source}
    </span>
  );
}
