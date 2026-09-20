import React, { useEffect, useRef, useState } from 'react';

const NUM_RE = /^([^\d-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/;

/** Animates the numeric part of a display value (handles "₹76.49Cr", "1,333", "38.6%"). */
function useAnimatedValue(value, duration = 600) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(null);
  useEffect(() => {
    const str = String(value ?? '');
    const m = str.match(NUM_RE);
    if (!m) { setDisplay(value); prev.current = null; return undefined; }
    const [, prefix, numStr, suffix] = m;
    const target = parseFloat(numStr.replace(/,/g, ''));
    const decimals = (numStr.split('.')[1] || '').length;
    const useGrouping = numStr.includes(',');
    const from = prev.current ?? target;
    prev.current = target;
    if (from === target) { setDisplay(value); return undefined; }
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = from + (target - from) * eased;
      const formatted = useGrouping ? cur.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : cur.toFixed(decimals);
      setDisplay(`${prefix}${formatted}${suffix}`);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

export default function StatCard({ label, value, sub, icon: Icon, tone = 'gold' }) {
  const shown = useAnimatedValue(value);
  const toneClasses = {
    gold: 'text-gold bg-gold/10 border-gold/20',
    green: 'text-risk-low bg-risk-low/10 border-risk-low/20',
    red: 'text-risk-critical bg-risk-critical/10 border-risk-critical/20',
    blue: 'text-risk-medium bg-risk-medium/10 border-risk-medium/20',
  }[tone];

  return (
    <div className="card card-hover p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</div>
          <div className="text-2xl font-bold text-white tabular-nums tracking-tight">{shown}</div>
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
