import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { KeyRound, ShieldAlert, LogOut } from 'lucide-react';
import api from '../utils/apiClient';

export default function ForcePasswordChange() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { completePasswordChange, logout, user } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) return setError('Passwords do not match.');
    if (newPassword.length < 8) return setError('Passwords must be at least 8 characters.');
    setIsLoading(true);
    const { ok, error: err } = await api.put('/api/auth/change-password', { newPassword });
    if (ok) completePasswordChange();
    else setError(err || 'Failed to update password.');
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full glass-modal animate-glass-in overflow-hidden">
        <div className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-white/8 via-transparent to-white/3 pointer-events-none z-10" />
        <div className="relative z-20 bg-gradient-to-r from-[color:var(--status-warning-strong)]/40 to-[color:var(--status-danger-strong)]/30 p-8 text-center border-b" style={{ borderColor: 'var(--glass-border-subtle)' }}>
          <div className="inline-flex p-3 rounded-2xl bg-white/15 mb-4 animate-float">
            <ShieldAlert size={40} className="tt" />
          </div>
          <h1 className="text-2xl font-black text-glow tt">Action Required</h1>
          <p className="tt-sec mt-1 text-sm">Please secure your account to continue.</p>
        </div>
        <form onSubmit={handleSubmit} className="relative z-20 p-8 space-y-5">
          <p className="text-sm text-center mb-4" style={{ color: 'var(--text-on-glass-secondary)' }}>
            Welcome, <strong style={{ color: 'var(--text-on-glass)' }}>{user?.name}</strong>. You must set a new password before accessing the studio.
          </p>
          {error && <div className="glass-badge glass-badge-red p-3 rounded-xl text-sm font-bold text-center">{error}</div>}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-label)' }}>New Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--text-on-glass-muted)' }}><KeyRound size={16} /></div>
              <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="glass-input pl-10" placeholder="••••••••" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-label)' }}>Confirm Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: 'var(--text-on-glass-muted)' }}><KeyRound size={16} /></div>
              <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="glass-input pl-10" placeholder="••••••••" />
            </div>
          </div>
          <button type="submit" disabled={isLoading} className="w-full glass-btn glass-btn-primary py-3 rounded-xl text-sm font-bold transition-all duration-200 disabled:opacity-50">
            {isLoading ? 'Encrypting...' : 'Secure Account & Proceed'}
          </button>
        </form>
      </div>
      <button onClick={logout} className="mt-8 flex items-center gap-2 transition-colors text-sm font-medium" style={{ color: 'var(--text-on-glass-muted)' }}>
        <LogOut size={16} /> Cancel and return to Login
      </button>
    </div>
  );
}
