'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { LINK_INVALID, ROLE_WORDS, finishSignIn, passwordProblem, type SessionResponse } from '../lib/auth-flow';
import { Icon } from './Icons';

type Kind = 'invite' | 'reset';
type Info = { email: string; clientName?: string | null; role?: string };

const PATHS: Record<Kind, { validate: string; submit: string }> = {
  invite: { validate: '/auth/accept-invite/validate', submit: '/auth/accept-invite' },
  reset: { validate: '/auth/reset-password/validate', submit: '/auth/reset-password' },
};

/**
 * The page behind an invitation link or a password reset link. It checks the link first (without using it up), says who
 * it is for, asks for a new password, then signs the person in and sends them home.
 */
export default function TokenPage({ kind }: { kind: Kind }) {
  const [phase, setPhase] = useState<'checking' | 'invalid' | 'trouble' | 'ready'>('checking');
  const [token, setToken] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token') || '';
    setToken(value);
    if (!value) { setPhase('invalid'); return; }
    setPhase('checking');
    let cancelled = false;
    api<Info>(PATHS[kind].validate, { method: 'POST', body: JSON.stringify({ token: value }) })
      .then((data) => { if (!cancelled) { setInfo(data); setPhase('ready'); } })
      .catch((e) => { if (!cancelled) setPhase(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'invalid' : 'trouble'); });
    return () => { cancelled = true; };
  }, [kind, attempt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setError('');
    setBusy(true);
    try {
      const res = await api<SessionResponse>(PATHS[kind].submit, { method: 'POST', body: JSON.stringify({ token, password }) });
      finishSignIn(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setPhase('invalid');
      else setError(e instanceof Error ? e.message : 'Could not save your password.');
      setBusy(false);
    }
  };

  const title = kind === 'invite' ? 'Welcome to Motion' : 'Choose a new password';
  const brand = <div className="brand-row"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">motion</span></div>;

  if (phase === 'checking') {
    return <main className="auth-page"><div className="card auth-card" aria-busy="true" role="status">{brand}<p className="auth-sub">Checking your link…</p></div></main>;
  }
  if (phase === 'invalid') {
    return <main className="auth-page"><div className="card auth-card">{brand}<h1>Link not valid</h1><p className="auth-sub" role="alert">{LINK_INVALID}</p><Link className="btn" href="/login">Go to sign in</Link></div></main>;
  }
  if (phase === 'trouble') {
    return <main className="auth-page"><div className="card auth-card">{brand}<h1>Could not check this link</h1><p className="auth-sub" role="alert">Something went wrong on our side. Try again in a moment.</p><button className="btn" type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div></main>;
  }

  const role = info?.role ? ROLE_WORDS[info.role] || 'a team member' : '';
  return <main className="auth-page">
    <form className="card auth-card" onSubmit={submit} aria-labelledby="token-title" noValidate>
      {brand}
      <div>
        <h1 id="token-title">{title}</h1>
        {kind === 'invite'
          ? <p className="auth-sub">{info?.clientName ? <>You are joining <strong>{info.clientName}</strong> as {role}. </> : null}Set a password to finish.</p>
          : <p className="auth-sub">Set a new password for your account.</p>}
        <p className="auth-sub"><span className="field-label">Email</span> <strong>{info?.email}</strong></p>
      </div>
      {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
      <div className="field">
        <label className="field-label" htmlFor="new-password">New password</label>
        <div className="password-field">
          <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="new-password-hint" aria-invalid={!!error || undefined} />
          <button type="button" className="password-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-controls="new-password confirm-password">{show ? 'Hide' : 'Show'}</button>
        </div>
        <span className="form-hint" id="new-password-hint">At least 8 characters.</span>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="confirm-password">Repeat the password</label>
        <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!error || undefined} />
      </div>
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : kind === 'invite' ? 'Set password and continue' : 'Save password and sign in'}</button>
      <p className="auth-switch"><Link className="card-action" href="/login">Back to sign in</Link></p>
    </form>
  </main>;
}
