'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '../../../components/Icons';
import { EmptyBlock, ErrorNotice, SkeletonRows } from '../../../components/admin/Feedback';
import NewClientDialog from '../../../components/admin/NewClientDialog';
import StatusBadge from '../../../components/admin/StatusBadge';
import { useDebounced, useDocumentTitle, useLoad } from '../../../components/admin/hooks';
import ChannelIcons from '../../../components/admin/ChannelIcons';
import { ClientFilter, listClients, timeAgo, exactTime } from '../../../lib/admin';

const FILTERS: { id: ClientFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'archived', label: 'Archived' },
];

export default function ClientsPage() {
  useDocumentTitle('Clients');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ClientFilter>('all');
  const q = useDebounced(query, 250);
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useLoad(() => listClients({ q, status }), [q, status]);
  const filtered = !!q.trim() || status !== 'all';

  return (
    <div>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Clients</h1>
          <p>Every workspace you look after. Open one to manage its channels, features and team.</p>
        </div>
        <div className="page-intro-actions">
          <button className="btn" type="button" onClick={() => setCreating(true)}><Icon name="plus" size={14} /> New client</button>
        </div>
      </section>

      <NewClientDialog open={creating} onOpenChange={setCreating} onCreated={() => void reload()} />

      <section className="card data-card" aria-labelledby="clients-title">
        <div className="adm-toolbar">
          <div className="adm-search">
            <label className="sr-only" htmlFor="client-search">Search clients by name</label>
            <Icon name="search" size={15} />
            <input id="client-search" type="search" placeholder="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
          </div>
          <div className="adm-filters" role="group" aria-label="Show clients">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`toolbar-filter ${status === f.id ? 'active' : ''}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</button>
            ))}
          </div>
        </div>
        <h2 className="sr-only" id="clients-title">Client list</h2>

        {error && <div className="adm-pad"><ErrorNotice message={error} onRetry={() => void reload()} busy={loading} /></div>}
        {loading && !data && <div className="adm-pad"><SkeletonRows count={4} label="Loading clients" /></div>}

        {data && data.length > 0 && (
          <div className="table-wrap" aria-busy={loading}>
            <table className="data-table adm-table">
              <thead>
                <tr>
                  <th scope="col">Client</th><th scope="col">Status</th><th scope="col">Channels</th><th scope="col">People</th>
                  <th scope="col">Scheduled</th><th scope="col">Failed</th><th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Client">
                      <Link className="adm-client-link" href={`/admin/clients/${c.id}`}>{c.name}</Link>
                      {c.staffWorkspace && <span className="adm-tag">Staff workspace</span>}
                    </td>
                    <td data-label="Status"><StatusBadge status={c.archived ? 'ARCHIVED' : c.status} /></td>
                    <td data-label="Channels"><ChannelIcons client={c} /></td>
                    <td data-label="People" className="table-secondary">
                      {c.seatsUsed} of {c.seatLimit}
                      {c.pendingInvites > 0 && <span className="adm-muted-count"> ({c.pendingInvites} invited)</span>}
                    </td>
                    <td data-label="Scheduled" className="table-secondary">{c.scheduledPosts}</td>
                    <td data-label="Failed" className={c.failedPosts ? 'adm-bad' : 'table-secondary'}>{c.failedPosts}</td>
                    <td data-label="Last activity" className="table-secondary"><span title={exactTime(c.lastActivityAt)}>{c.lastActivityAt ? timeAgo(c.lastActivityAt) : 'No activity yet'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.length === 0 && !error && (
          filtered
            ? <EmptyBlock icon="search" title="No clients match">Try a different search or filter.</EmptyBlock>
            : <EmptyBlock icon="grid" title="No clients yet">Create the first one and send its main contact the invite link.</EmptyBlock>
        )}
        {status === 'all' && !error && <p className="form-hint adm-pad">Archived clients are listed under Archived.</p>}
      </section>
    </div>
  );
}
