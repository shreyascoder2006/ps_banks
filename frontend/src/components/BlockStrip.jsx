import { Box, Link2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { client } from '../api/client';
import { useEvent } from '../lib/realtime';

export default function BlockStrip({ limit = 12 }) {
  const [data, setData] = useState(null);
  const [fresh, setFresh] = useState(null);
  const scrollRef = useRef(null);

  const load = () => client.get('/blockchain/blocks', { params: { limit } }).then((res) => {
    setData((prev) => {
      if (prev?.head != null && res.data.head > prev.head) {
        setFresh(res.data.head);
        setTimeout(() => setFresh(null), 2500);
      }
      return res.data;
    });
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth; });
  });

  useEffect(() => { load(); }, []);
  useEvent('audit', () => setTimeout(load, 300));

  if (!data) return <div className="skeleton h-20" />;
  if (data.status !== 'ok') return <p className="text-xs text-gray-500">Chain not available ({data.status}).</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><Link2 size={12} /> chain id {data.chainId} · head #{data.head}</span>
        <span>gold = carries an audit record · grows live</span>
      </div>
      <div ref={scrollRef} className="flex items-center gap-0 overflow-x-auto pb-2">
        {data.blocks.map((b, i) => {
          const isAudit = b.auditTxCount > 0;
          const isFresh = b.number === fresh;
          return (
            <React.Fragment key={b.number}>
              {i > 0 && <div className={`h-px w-6 shrink-0 ${isAudit ? 'bg-gold/50' : 'bg-white/10'}`} />}
              <div
                className={`shrink-0 w-[92px] rounded-lg border px-2.5 py-2 text-center transition-all duration-500 ${
                  isAudit ? 'bg-gold/[0.10] border-gold/40' : 'bg-white/[0.03] border-white/[0.08]'
                } ${isFresh ? 'scale-110 shadow-glow' : ''}`}
                title={`block ${b.number} · ${b.txCount} tx · gas ${b.gasUsed}`}
              >
                <Box size={14} className={`mx-auto mb-1 ${isAudit ? 'text-gold' : 'text-gray-500'}`} />
                <div className="text-xs text-white font-semibold tabular-nums">#{b.number}</div>
                <div className="text-[10px] text-gray-500 font-mono truncate">{b.hash}</div>
                <div className={`text-[10px] mt-0.5 ${isAudit ? 'text-gold' : 'text-gray-600'}`}>{isAudit ? `${b.auditTxCount} audit tx` : b.txCount ? `${b.txCount} tx` : 'genesis'}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
