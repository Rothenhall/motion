'use client';

import { useEffect, useState } from 'react';
import { API, api } from '../../lib/api';
import { Icon } from '../../components/Icons';

type Account = { id: string; provider: string; externalId: string; name?: string | null; createdAt: string };

const providers = [
  { id: 'instagram', title: 'Instagram', desc: 'Posts, Reels, comments and DMs — synced automatically.', icon: 'instagram' as const, tone: 'instagram', href: `${API}/auth/instagram`, match: 'instagram' },
  { id: 'facebook', title: 'Facebook', desc: 'Pages, publishing and community inbox — synced automatically.', icon: 'facebook' as const, tone: 'facebook', href: `${API}/auth/facebook`, match: 'facebook_page' },
  { id: 'threads', title: 'Threads', desc: 'Text-first publishing — synced automatically.', icon: 'threads' as const, tone: 'threads', href: `${API}/auth/threads`, match: 'threads' },
];

function label(provider: string) { return provider === 'facebook_page' ? 'Facebook' : provider === 'threads' ? 'Threads' : 'Instagram'; }
function tone(provider: string) { return provider === 'facebook_page' ? 'facebook' : provider === 'threads' ? 'threads' : 'instagram'; }
function iconFor(provider: string) { return (provider === 'facebook_page' ? 'facebook' : provider === 'threads' ? 'threads' : 'instagram') as 'facebook' | 'threads' | 'instagram'; }

const steps = [
  { title: 'Connect', desc: 'One click per channel' },
  { title: 'Authorize', desc: 'Approve on Meta' },
  { title: 'Synced', desc: 'Posts, inbox & stats appear' },
];

export default function Connect() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [isError, setIsError] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setAccounts(await api('/accounts')); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load connections.'); setIsError(true); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    // OAuth landing: ?connected=instagram&account=@foo or ?error=...
    const query = new URLSearchParams(window.location.search);
    const connected = query.get('connected');
    const account = query.get('account');
    const error = query.get('error');
    if (connected) {
      setNotice(`${account || 'Channel'} connected — recent posts and stats are syncing in.`);
      setIsError(false);
    } else if (error) {
      setNotice(error);
      setIsError(true);
    }
    if (connected || error) window.history.replaceState(null, '', '/connect');
  }, []);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Disconnect "${name}"? Scheduled posts for this channel will be paused.`)) return;
    await api(`/accounts/${id}`, { method: 'DELETE' });
    setAccounts((current) => current.filter((account) => account.id !== id));
    setNotice('Account disconnected.');
    setIsError(false);
  };

  const accountFor = (match: string) => accounts.find((a) => a.provider === match);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Channel management</div><h2>Bring your channels together</h2><p>Connect once — Motion syncs your posts, inbox and stats automatically.</p></div>
      <div className="page-intro-actions"><span className="live-pill" role="status"><i aria-hidden="true" />{accounts.length} connected</span></div>
    </section>

    {notice && <div className={`notice ${isError ? 'notice-error' : 'notice-success'}`} role="alert" aria-live="polite"><Icon name={isError ? 'alert' : 'check'} size={15} /> {notice}</div>}

    <section className="card" style={{ padding: '16px 22px', marginBottom: 16, display: 'flex', gap: 22, flexWrap: 'wrap' }} aria-label="How connecting works">
      {steps.map((s, i) => (
        <div key={s.title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="stat-icon" aria-hidden="true" style={{ width: 28, height: 28, fontSize: 12, fontWeight: 700 }}>{i + 1}</span>
          <div><strong style={{ display: 'block', fontSize: 12.5 }}>{s.title}</strong><span className="muted" style={{ fontSize: 11.5 }}>{s.desc}</span></div>
        </div>
      ))}
    </section>

    <div className="connection-grid">
      {providers.map((provider) => {
        const existing = accountFor(provider.match);
        return (
          <div className="card connection-card" key={provider.id}>
            <span className={`platform-avatar ${provider.tone}`} aria-hidden="true"><Icon name={provider.icon} size={17} /></span>
            <div className="connection-copy">
              {existing ? <span className="connection-state">Connected · {existing.name || 'Active'}</span> : <span className="connection-state" style={{ color: 'var(--text-3)' }}>Not connected</span>}
              <strong>{provider.title}</strong><p>{provider.desc}</p>
              {existing
                ? <a className="btn btn-soft btn-sm" href="#connected-accounts">Manage connection</a>
                : <a className="btn btn-ghost btn-sm" href={provider.href}><Icon name="link" size={13} /> Connect {provider.title}</a>}
            </div>
          </div>
        );
      })}
    </div>

    <section className="card data-card" id="connected-accounts" aria-labelledby="accounts-title">
      <div className="card-header"><div><h3 className="card-title" id="accounts-title">Connected accounts <span className="list-count">{accounts.length}</span></h3><p className="card-subtitle">Tokens refresh automatically — you never touch them.</p></div></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td><div className="account-row"><span className={`platform-avatar ${tone(account.provider)}`} aria-hidden="true"><Icon name={iconFor(account.provider)} size={13} /></span><div><strong>{account.name || 'Unnamed account'}</strong><span>{label(account.provider)} · {account.externalId}</span></div></div></td>
                <td className="table-secondary">{new Date(account.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td><div className="table-actions"><span className="status-pill status-active">Live</span><button className="icon-btn" type="button" onClick={() => remove(account.id, account.name || 'account')} aria-label={`Disconnect ${account.name || 'account'}`}><Icon name="trash" size={14} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="empty-state" aria-busy="true">Syncing your channels…</div>}
        {!loading && !accounts.length && <div className="empty-state"><div className="empty-icon"><Icon name="link" size={18} /></div><strong>No channels connected</strong>Connect Instagram, Facebook, or Threads above — everything syncs on its own.</div>}
      </div>
    </section>
  </div>;
}
