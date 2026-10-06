'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Icon } from '../../components/Icons';
import { useConfirm } from '../../components/ConfirmDialog';
import { errorText } from '../../lib/format';

type Account = { id: string; provider: string; externalId: string; name?: string | null; createdAt: string };

const providers = [
  { id: 'instagram', title: 'Instagram', desc: 'Posts, Reels, comments and DMs, synced automatically.', icon: 'instagram' as const, tone: 'instagram', match: 'instagram' },
  { id: 'facebook', title: 'Facebook', desc: 'Pages, publishing and community inbox, synced automatically.', icon: 'facebook' as const, tone: 'facebook', match: 'facebook_page' },
  { id: 'threads', title: 'Threads', desc: 'Text-first publishing, synced automatically.', icon: 'threads' as const, tone: 'threads', match: 'threads' },
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
  const [connecting, setConnecting] = useState('');
  const [confirm, confirmDialog] = useConfirm();

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
      setNotice(`${account || 'Channel'} connected. Recent posts and stats are syncing in.`);
      setIsError(false);
    } else if (error) {
      setNotice(error);
      setIsError(true);
    }
    if (connected || error) window.history.replaceState(null, '', '/connect');
  }, []);

  const remove = async (id: string, name: string) => {
    if (!(await confirm({ title: `Disconnect ${name}?`, description: 'Scheduled posts for this channel will stop publishing until you connect it again.', confirmLabel: 'Disconnect', destructive: true }))) return;
    try {
      await api(`/accounts/${id}`, { method: 'DELETE' });
      setAccounts((current) => current.filter((account) => account.id !== id));
      toast.success(`${name} disconnected`);
    } catch (error) { toast.error(errorText(error, 'Could not disconnect this account.')); }
  };

  // The backend signs an OAuth `state` for this user, so the Meta callback lands in the right workspace.
  const connect = async (provider: string) => {
    setConnecting(provider);
    try { window.location.assign((await api<{ url: string }>(`/auth/${provider}/start`)).url); }
    catch (error) { setConnecting(''); toast.error(errorText(error, 'Could not start connecting.')); }
  };

  const accountFor = (match: string) => accounts.find((a) => a.provider === match);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Channel management</div><h1>Bring your channels together</h1><p>Connect once and Motion syncs your posts, inbox and stats automatically.</p></div>
      <div className="page-intro-actions"><span className={accounts.length ? 'live-pill' : 'status-pill status-draft'}>{accounts.length > 0 && <i aria-hidden="true" />}{accounts.length} connected</span></div>
    </section>

    {notice && <div className={`notice ${isError ? 'notice-error' : 'notice-success'}`} role={isError ? 'alert' : 'status'}><Icon name={isError ? 'alert' : 'check'} size={15} /> {notice}</div>}

    {confirmDialog}

    <ol className="card steps-card" aria-label="How connecting works">
      {steps.map((s, i) => (
        <li key={s.title} className="step">
          <span className="step-number" aria-hidden="true">{i + 1}</span>
          <div><strong>{s.title}</strong><span>{s.desc}</span></div>
        </li>
      ))}
    </ol>

    <div className="connection-grid">
      {providers.map((provider) => {
        const existing = accountFor(provider.match);
        return (
          <div className="card connection-card" key={provider.id}>
            <span className={`platform-avatar ${provider.tone}`} aria-hidden="true"><Icon name={provider.icon} size={17} /></span>
            <div className="connection-copy">
              {existing ? <span className="connection-state">Connected · {existing.name || 'Active'}</span> : <span className="connection-state connection-state-off">Not connected</span>}
              <strong>{provider.title}</strong><p>{provider.desc}</p>
              {existing
                ? <a className="btn btn-soft btn-sm" href="#connected-accounts">Manage connection</a>
                : <button className="btn btn-sm" type="button" onClick={() => connect(provider.id)} disabled={!!connecting}><Icon name="link" size={13} /> {connecting === provider.id ? 'Opening Meta…' : `Connect ${provider.title}`}</button>}
            </div>
          </div>
        );
      })}
    </div>

    <section className="card data-card" id="connected-accounts" aria-labelledby="accounts-title">
      <div className="card-header"><div><h2 className="card-title" id="accounts-title">Connected accounts <span className="list-count">{accounts.length}</span></h2><p className="card-subtitle">Tokens refresh automatically, so you never touch them.</p></div></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Added</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td><div className="account-row"><span className={`platform-avatar ${tone(account.provider)}`} aria-hidden="true"><Icon name={iconFor(account.provider)} size={13} /></span><div><strong>{account.name || 'Unnamed account'}</strong><span>{label(account.provider)} · {account.externalId}</span></div></div></td>
                <td className="table-secondary">{new Date(account.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td><div className="table-actions"><span className="status-pill status-active">Connected</span><button className="icon-btn icon-btn-danger" type="button" onClick={() => remove(account.id, account.name || 'account')} aria-label={`Disconnect ${account.name || 'account'}`}><Icon name="trash" size={14} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="skeleton skeleton-row" aria-hidden="true" />}
        {!loading && !accounts.length && <div className="empty-state"><div className="empty-icon"><Icon name="link" size={18} /></div><strong>No channels connected</strong>Connect Instagram, Facebook, or Threads above and everything syncs on its own.</div>}
      </div>
    </section>
  </div>;
}
