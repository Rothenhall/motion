'use client';

import { FormEvent, useState } from 'react';
import { api, setToken } from '../../lib/api';
import { Icon } from '../../components/Icons';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ token: string }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      setToken(res.token);
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <form className="card auth-card" onSubmit={submit} aria-labelledby="auth-title">
      <div className="brand-row"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">motion</span></div>
      <div>
        <h1 id="auth-title">{registering ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-sub">{registering ? 'Schedule posts, automate replies and find your next idea.' : 'Sign in to your Motion workspace.'}</p>
      </div>
      {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
      <div className="field">
        <label className="field-label" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error || undefined} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="password">Password</label>
        <div className="password-field">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={registering ? 'password-hint' : undefined}
            aria-invalid={!!error || undefined}
          />
          <button type="button" className="password-toggle" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword} aria-controls="password">
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        {registering && <span className="form-hint" id="password-hint">At least 8 characters.</span>}
      </div>
      <button className="btn" type="submit" disabled={busy}>{busy ? (registering ? 'Creating account…' : 'Signing in…') : registering ? 'Create account' : 'Sign in'}</button>
      <p className="auth-switch">
        {registering ? 'Already have an account?' : 'New to Motion?'}{' '}
        <button className="card-action" type="button" onClick={() => { setMode(registering ? 'login' : 'register'); setError(''); }}>
          {registering ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </form>
  </main>;
}
