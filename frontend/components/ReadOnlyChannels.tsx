'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icons';
import { api } from '../lib/api';
import { expiryWarning } from '../lib/channels';
import { errorText, platformFor, platformName } from '../lib/format';

type Account = { id: string; provider: string; externalId: string; name?: string | null; tokenExpires?: string | null };

/** What a client sees: the channels their agency connected, with no way to add or remove one. */
export default function ReadOnlyChannels() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Account[]>('/accounts').then((list) => setAccounts(list || [])).catch((e) => { setError(errorText(e, 'Could not load your channels.')); setAccounts([]); });
  }, []);
  const list = accounts || [];
  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Your channels</div><h1>Connected channels</h1><p>Channels are connected and managed by your agency. To add or change one, contact your account manager.</p></div>
      <div className="page-intro-actions"><span className={list.length ? 'live-pill' : 'status-pill status-draft'}>{list.length > 0 && <i aria-hidden="true" />}{list.length} connected</span></div>
    </section>
    {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
    <section className="card data-card" aria-labelledby="channels-title">
      <div className="card-header"><div><h2 className="card-title" id="channels-title">Channels <span className="list-count">{list.length}</span></h2></div></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Channel</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {list.map((account) => {
              const warning = expiryWarning(account.tokenExpires);
              const platform = platformFor(account.provider);
              return (
                <tr key={account.id}>
                  <td><div className="account-row"><span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform} size={13} /></span><div><strong>{account.name || 'Unnamed account'}</strong><span>{platformName(account.provider)}</span></div></div></td>
                  <td>{warning ? <span className="status-pill status-pending">{warning}. Ask your account manager.</span> : <span className="status-pill status-active">Connected</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {accounts === null && <div className="skeleton skeleton-row" aria-hidden="true" />}
        {accounts !== null && !list.length && <div className="empty-state"><div className="empty-icon"><Icon name="link" size={18} /></div><strong>No channels connected yet</strong>Your account manager connects them for you.</div>}
      </div>
    </section>
  </div>;
}
