import React, { useEffect, useState } from 'react';
import { client } from '../api/client';
import Card from '../components/Card';

function ComponentRow({ label, comp }) {
  return (
    <div className="flex justify-between items-center border-t border-white/5 py-2 text-sm">
      <span className="text-gray-300">{label}</span>
      <span className="text-right">
        <span className="text-gold font-semibold">{comp.score}</span>{' '}
        <span className={`text-xs ${comp.source === 'live' ? 'text-green-400' : 'text-yellow-400'}`}>({comp.source})</span>
        <div className="text-xs text-gray-500">{comp.detail}</div>
      </span>
    </div>
  );
}

export default function MarketSentiment() {
  const [data, setData] = useState(null);

  useEffect(() => {
    client.get('/sentiment/market').then((res) => setData(res.data));
  }, []);

  if (!data) return <p className="text-gray-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Banking Market Sentiment Index</h1>
      <Card>
        <div className="text-center mb-4">
          <div className="text-5xl font-bold text-gold">{data.composite_score}</div>
          <div className="text-xs text-gray-400">Composite score (0-100)</div>
        </div>
        <ComponentRow label="Search interest (Google Trends, banking keywords)" comp={data.components.search_interest} />
        <ComponentRow label="Banking stocks (5-day change, NSE bank tickers)" comp={data.components.banking_stocks} />
        <ComponentRow label="News sentiment (VADER)" comp={data.components.news_sentiment} />
        <p className="text-xs text-gray-500 mt-4">{data.note}</p>
      </Card>
    </div>
  );
}
