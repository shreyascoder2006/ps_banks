import React from 'react';

export default function Card({ title, action, children, className = '', noPad = false }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-1">
          {title && <h3 className="kicker">{title}</h3>}
          {action}
        </div>
      )}
      <div className={noPad ? '' : 'p-5'}>{children}</div>
    </div>
  );
}
