import { ArrowLeft, Coins, Inbox, Megaphone, ShieldAlert, User } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { client } from '../api/client';
import { RiskBadge } from '../components/Badge';
import Card from '../components/Card';
import OutreachPanel from '../components/OutreachPanel';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import WhatIfSimulator from '../components/WhatIfSimulator';
import { useToast } from '../components/Toast';

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-200 mt-0.5">{value}</div>
    </div>
  );
}

const OUTCOME_STYLES = {
  retained: 'bg-risk-low/15 text-risk-low',
  churned: 'bg-risk-critical/15 text-risk-critical',
  no_response: 'bg-gray-500/15 text-gray-400',
};

export default function Customer360() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    client.get(`/customers/${id}/360`).then((res) => setData(res.data)).catch((err) => setError(err.response?.data?.detail || 'Failed to load'));

  useEffect(() => { load(); }, [id]);

  if (error) return <div className="text-red-300">{error}</div>;
  if (!data) return <div className="skeleton h-96" />;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gold mb-3">
        <ArrowLeft size={12} /> Back
      </button>
      <PageHeader
        icon={User}
        title={`${data.surname} · ${data.accountNo}`}
        subtitle={`${data.branch} · ${data.segment.replace('_', ' ')} · ${data.geography} · joined ${new Date().getFullYear() - data.tenure}`}
        action={<RiskBadge level={data.churnRiskLevel}>{data.churnRiskScore.toFixed(1)}% {data.churnRiskLevel}</RiskBadge>}
      />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Balance" value={`₹${data.balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone="gold" />
        <StatCard label="Credit score" value={data.creditScore} tone={data.creditScore < 600 ? 'red' : 'blue'} />
        <StatCard label="RFM segment" value={data.rfm.segment} sub={`${data.rfm.loyaltyTokens} loyalty tokens`} icon={Coins} tone="gold" />
        <StatCard label="Open complaints" value={data.complaints.filter((c) => c.status !== 'resolved').length} icon={Inbox} tone="blue" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card title="Profile">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Age" value={data.age} />
              <Field label="Tenure" value={`${data.tenure} yrs`} />
              <Field label="Active member" value={data.isActiveMember ? 'Yes' : 'No'} />
              <Field label="Products" value={data.products.map((p) => p.replace('_', ' ')).join(', ')} />
              <Field label="Last active (proxy)" value={`${data.lastActiveDaysProxy} days ago`} />
              <Field label="Est. salary" value={`₹${Math.round(data.estimatedSalary).toLocaleString('en-IN')}`} />
            </div>
          </Card>

          <Card title="Why this risk score">
            <ul className="space-y-1.5">
              {data.churnDrivers.map((d, i) => (
                <li key={i} className="text-sm text-gray-300 flex gap-2 items-start">
                  <ShieldAlert size={14} className="text-risk-high mt-0.5 shrink-0" /> {d}
                </li>
              ))}
            </ul>
            <div className="mt-3 rounded-lg bg-gold/[0.06] border border-gold/10 px-3 py-2 text-sm">
              <span className="text-gold/70 text-[11px] uppercase tracking-wide font-semibold">Recommended action</span>
              <div className="text-white">{data.recommendedAction}</div>
            </div>
          </Card>

          <Card title={`Complaint history (${data.complaints.length})`} noPad>
            {data.complaints.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">No complaints on file.</p>
            ) : (
              <table className="table-modern">
                <thead><tr><th>ID</th><th>Subject</th><th>Severity</th><th>Status</th><th>Logged</th></tr></thead>
                <tbody>
                  {data.complaints.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs text-gray-500">{c.id}</td>
                      <td className="text-white">{c.subject}</td>
                      <td><RiskBadge level={c.severity}>{c.severity}</RiskBadge></td>
                      <td className="text-gray-400 capitalize">{c.status.replace('_', ' ')}</td>
                      <td className="text-gray-500 text-xs">{new Date(c.timestamp).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={`Outreach history (${data.outreach.length})`} noPad>
            {data.outreach.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">No outreach yet.</p>
            ) : (
              <table className="table-modern">
                <thead><tr><th>#</th><th>Channel</th><th>Offer</th><th>Risk at trigger</th><th>Outcome</th><th>When</th></tr></thead>
                <tbody>
                  {data.outreach.map((a) => (
                    <tr key={a.id}>
                      <td className="text-gray-500">{a.id}</td>
                      <td className="text-white">{a.channelLabel}</td>
                      <td className="text-gray-400 text-xs">{a.offerType}</td>
                      <td className="tabular-nums text-gray-300">{a.riskScoreAtTrigger.toFixed(0)}%</td>
                      <td>{a.outcome ? <span className={`badge ${OUTCOME_STYLES[a.outcome]}`}>{a.outcome.replace('_', ' ')}</span> : <span className="text-gray-500 text-xs">pending</span>}</td>
                      <td className="text-gray-500 text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="What-if intervention simulator">
            <WhatIfSimulator customerId={data.customerId} baseline={data} />
          </Card>
          <Card title="Current offer">
            <div className="text-sm text-gold font-medium mb-1">{data.offer.offer_type}</div>
            <p className="text-sm text-gray-400 leading-relaxed">{data.offer.message}</p>
          </Card>
          <Card title="Predictive outreach" action={<Megaphone size={14} className="text-gold" />}>
            <OutreachPanel
              customerId={data.customerId}
              onTriggered={(r) => { load(); toast(`Outreach #${r.action.id} triggered via ${r.action.channelLabel} · audit ${r.audit?.status}`, 'success'); }}
            />
          </Card>
          <Link to="/complaints" className="block text-xs text-gold hover:underline">Open Resolve inbox →</Link>
        </div>
      </div>
    </div>
  );
}
