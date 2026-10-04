'use client';

import { FormEvent, useState } from 'react';
import { api, setToken } from '../../lib/api';
import { Icon } from '../../components/Icons';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page">
    <form className="card auth-card" onSubmit={submit}>
      <div className="brand-row"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">motion</span></div>
      <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
      <label className="field"><span className="field-label">Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span className="field-label">Password</span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
      <button className="btn btn-ghost" type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? 'New to Motion? Create an account' : 'Already have an account? Sign in'}
      </button>
    </form>
  </main>;
}
