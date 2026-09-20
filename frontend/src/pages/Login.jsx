import { Landmark, Lock, User } from 'lucide-react';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Badge';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('agent');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/pulse');
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-radial-fade pointer-events-none" />
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-gold/[0.06] rounded-full blur-3xl" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-risk-medium/[0.06] rounded-full blur-3xl" />

      <form onSubmit={onSubmit} className="card p-8 w-[380px] relative fade-in">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-gold-light to-gold flex items-center justify-center shadow-glow mb-3">
            <Landmark size={22} className="text-navy-dark" strokeWidth={2.5} />
          </div>
          <h1 className="text-white text-lg font-bold tracking-tight">ps_banks console</h1>
          <p className="text-xs text-gray-500 mt-1">Sign in to access customer intelligence</p>
        </div>

        <div className="mb-4 px-3 py-2 rounded-lg bg-gold/[0.06] border border-gold/10 text-[11px] text-gold/80 text-center">
          Demo accounts &mdash; agent / agent123 &middot; admin / admin123
        </div>

        <div className="space-y-3.5">
          <div>
            <label className="text-xs text-gray-400 font-medium">Username</label>
            <div className="relative mt-1.5">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                className="input-field pl-9 py-2.5"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 font-medium">Password</label>
            <div className="relative mt-1.5">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="password"
                className="input-field pl-9 py-2.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-risk-critical/10 border border-risk-critical/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-5 flex items-center justify-center gap-2">
          {loading && <Spinner size={14} className="text-navy-dark" />}
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
