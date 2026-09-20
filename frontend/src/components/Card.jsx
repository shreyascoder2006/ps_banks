import React from 'react';

export default function Card({ title, children, className = '' }) {
  return (
    <div className={`card p-4 ${className}`}>
      {title && <h3 className="text-gold text-sm font-semibold mb-3 uppercase tracking-wide">{title}</h3>}
      {children}
    </div>
  );
}
