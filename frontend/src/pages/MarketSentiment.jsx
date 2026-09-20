import { LineChart as LineChartIcon, Newspaper, Search, Sparkles } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import { SourceTag } from '../components/Badge';
import Card from '../components/Card';
import PageHeader from '../components/PageHeader';

const COMPONENT_META = {
  search_interest: { label: 'Search interest', hint: 'Google Trends, banking keywords', icon: Search },
  banking_stocks: { label: 'Banking stocks', hint: '5-day change, NSE bank tickers', icon: LineChartIcon },
  news_sentiment: { label: 'News sentiment', hint: 'VADER compound score', icon: Newspaper },
};

function ScoreRing({ score }) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 60 ? '#34d399' : score >= 40 ? '#d4af37' : '#f43f5e';

  return (
    <div className="relative w-40 h-40 mx-auto">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <circle
          cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-3xl font-bold text-white tabular-nums">{score}</div>
        <div className="text-[10px] text-gray-500 uppercase tracking-wide mt-0.5">/ 100</div>
      </div>
    </div>
  );
}

function ComponentRow({ meta, comp }) {
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 py-3 border-t border-white/[0.05] first:border-t-0">
      <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
        <Icon size={15} className="text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{meta.label}</span>
          <SourceTag source={comp.source} />
        </div>
        <div className="text-xs text-gray-500 mt-0.5 truncate">{comp.detail}</div>
      </div>
      <div className="text-lg font-bold text-gold tabular-nums shrink-0">{comp.score}</div>
    </div>
  );
}

export default function MarketSentiment() {
  const [data, setData] = useState(null);

  useEffect(() => {
    client.get('/sentiment/market').then((res) => setData(res.data));
  }, []);

  return (
    <div>
      <PageHeader
        icon={Sparkles}
        title="Banking Market Sentiment Index"
        subtitle="Composite of live search interest, bank-stock momentum, and news sentiment — each component tagged live or fallback."
      />

      {!data ? (
        <div className="skeleton h-80" />
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <Card>
            <ScoreRing score={data.composite_score} />
            <p className="text-center text-xs text-gray-500 mt-4">Composite score</p>
          </Card>
          <Card noPad>
            <div className="px-5">
              {Object.entries(data.components).map(([key, comp]) => (
                <ComponentRow key={key} meta={COMPONENT_META[key]} comp={comp} />
              ))}
            </div>
            <div className="px-5 py-3 border-t border-white/[0.05] text-xs text-gray-500">{data.note}</div>
          </Card>
        </div>
      )}
    </div>
  );
}
