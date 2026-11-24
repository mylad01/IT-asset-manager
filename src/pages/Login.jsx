import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, ShieldCheck, ShieldAlert } from 'lucide-react';
import api from '../utils/apiClient';
import AuthorFooter from '../components/AuthorFooter';

const RING_RADIUS = 36;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CooldownTimer({ totalSeconds, onDone }) {
  const [remaining, setRemaining] = useState(totalSeconds);
  useEffect(() => {
    if (remaining <= 0) { onDone(); return; }
    const id = setInterval(() => setRemaining(r => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, onDone]);
  const progress = remaining / totalSeconds;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return (
    <div className="relative rounded-2xl overflow-hidden animate-slide-up" style={{
      background: 'var(--modal-bg)',
      backdropFilter: 'var(--glass-blur-heavy)',
      border: '1px solid var(--glass-border)',
      boxShadow: 'var(--glass-shadow-xl), var(--glass-highlight)',
    }}>
      <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-[color:var(--status-warning-strong)]/10 via-transparent to-[color:var(--status-warning-strong)]/8 pointer-events-none" />
      <div className="relative z-10 p-5 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-[color:var(--status-warning)]" />
          <span className="text-xs font-bold text-[color:var(--status-warning-hi)]/80 uppercase tracking-widest">Security Throttle</span>
        </div>
        <div className="relative" style={{ width: 88, height: 88 }}>
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
            <circle cx="44" cy="44" r={RING_RADIUS} fill="none" stroke="url(#ring-grad)" strokeWidth="5" strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
            <defs><linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#f97316" />
            </linearGradient></defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black tt font-mono tabular-nums leading-none">{m}:{String(s).padStart(2, '0')}</span>
          </div>
        </div>
        <p className="text-xs tt-muted text-center leading-relaxed">
          Too many login attempts.<br />Please wait for the cooldown to expire.
        </p>
      </div>
      <div className="absolute inset-0 rounded-[20px] pointer-events-none"
        style={{ background: 'linear-gradient(135deg, var(--modal-specular) 0%, transparent 40%, transparent 70%, var(--specular-subtle) 100%)' }} />
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();

  const doLogin = useCallback(async () => {
    setError('');
    setIsLoading(true);
    const { ok, status, data, retryAfter } = await api.post('/api/auth/login', { email, password }, { showToast: false });
    if (ok) login(data.user, data.token);
    else if (status === 429) setCooldown(retryAfter || 60);
    else setError(data?.error || 'Login failed');
    setIsLoading(false);
  }, [email, password, login]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await doLogin();
  };

  const handleCooldownDone = useCallback(() => {
    setCooldown(0);
    // Auto-retry login if credentials are filled
    if (email.trim() && password.trim()) {
      doLogin();
    }
  }, [email, password, doLogin]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full glass-modal animate-glass-in overflow-hidden">
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 bg-gradient-to-r from-[color:var(--status-info-strong)]/40 to-[color:var(--ui-purple-strong)]/30 p-8 text-center border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
          <div className="inline-flex p-3 rounded-2xl bg-white/15 mb-4 animate-float">
            <ShieldCheck size={40} className="tt" />
          </div>
          <h1 className="text-2xl font-black text-glow tt">Studio IT Sync</h1>
          <p className="tt-sec mt-1 text-sm">Enterprise Asset Management</p>
        </div>
        <form onSubmit={handleSubmit} className="relative z-20 p-8 space-y-5">
          {cooldown > 0 ? (
            <CooldownTimer totalSeconds={cooldown} onDone={handleCooldownDone} />
          ) : error && (
            <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold text-center">{error}</div>
          )}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-label)' }}>Username or Email</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--text-on-glass-muted)' }}><User size={16} /></div>
              <input type="text" required value={email} onChange={(e) => setEmail(e.target.value)} className="glass-input pl-10" placeholder="e.g., admin or user@studio.com" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-label)' }}>Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--text-on-glass-muted)' }}><Lock size={16} /></div>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="glass-input pl-10" placeholder="••••••••" />
            </div>
          </div>
          <button type="submit" disabled={isLoading || cooldown > 0} className="w-full glass-btn glass-btn-primary py-3 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-50">
            {isLoading ? 'Authenticating...' : cooldown > 0 ? 'Cooldown Active...' : 'Secure Login'}
          </button>
        </form>
      </div>
      <AuthorFooter className="mt-4" />
    </div>
  );
}
