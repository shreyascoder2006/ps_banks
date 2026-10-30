import { Headset, Landmark, ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Badge';

const PERSONAS = [
  {
    id: 'agent',
    username: 'agent',
    password: 'agent123',
    label: 'Agent',
    description: 'Mumbai Main branch — frontline view: customers, complaints, outreach.',
    icon: Headset,
  },
  {
    id: 'admin',
    username: 'admin',
    password: 'admin123',
    label: 'Admin',
    description: 'Full access — forecasts, segments, policy assistant, audit trail.',
    icon: ShieldCheck,
  },
];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true });
  }, [isAuthenticated, navigate]);

  const choose = async (persona) => {
    setError('');
    setLoadingId(persona.id);
    try {
      await login(persona.username, persona.password);
      navigate('/');
    } catch (err) {
      console.error('Login request failed:', err);
      const apiBase = import.meta.env.VITE_API_BASE_URL || '(default)';
      if (err.response) {
        setError(`${err.response.status}: ${err.response.data?.detail || 'Login failed'}`);
      } else {
        setError(`Network error reaching API (base="${apiBase}"): ${err.message}`);
      }
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-radial-fade pointer-events-none" />
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-gold/[0.06] rounded-full blur-3xl" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-risk-medium/[0.06] rounded-full blur-3xl" />

      <div className="card p-8 w-[420px] relative fade-in">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-light to-gold flex items-center justify-center shadow-glow mb-3">
            <Landmark size={22} className="text-navy-dark" strokeWidth={2.5} />
          </div>
          <h1 className="text-white text-lg font-bold tracking-tight">Bank Pulse console</h1>
          <p className="text-xs text-gray-500 mt-1">Choose a persona to continue</p>
        </div>

        <div className="space-y-3">
          {PERSONAS.map((persona) => {
            const Icon = persona.icon;
            const busy = loadingId === persona.id;
            return (
              <button
                key={persona.id}
                type="button"
                disabled={loadingId !== null}
                onClick={() => choose(persona)}
                className="input-field w-full flex items-center gap-3 py-3 px-3.5 text-left hover:border-gold/40 transition-colors disabled:opacity-60"
              >
                <div className="w-9 h-9 shrink-0 rounded-lg bg-gold/[0.08] border border-gold/10 flex items-center justify-center">
                  {busy ? <Spinner size={16} className="text-gold" /> : <Icon size={16} className="text-gold" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{persona.label}</div>
                  <div className="text-[11px] text-gray-500 truncate">{persona.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-risk-critical/10 border border-risk-critical/20 text-red-300 text-xs">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
