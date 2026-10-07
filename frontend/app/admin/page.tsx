'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { EmptyBlock, ErrorNotice, SkeletonRows } from '../../components/admin/Feedback';
import { useDocumentTitle, useLoad } from '../../components/admin/hooks';
import { Overview, getOverview, plural, tabForReasons } from '../../lib/admin';

const sentence = (reason: string) => reason.charAt(0).toUpperCase() + reason.slice(1);

function Tile({ label, value, hint, bad }: { label: string; value: number; hint?: string; bad?: boolean }) {
  return (
    <div className="card adm-tile">
      <span className="adm-tile-label">{label}</span>
      <strong className={bad && value > 0 ? 'adm-bad' : ''}>{value}</strong>
      {hint && <span className="adm-tile-hint">{hint}</span>}
    </div>
  );
}

export default function AdminOverviewPage() {
  useDocumentTitle('Admin');
  const { data, error, loading, reload } = useLoad<Overview>(getOverview, []);
  const [returned, setReturned] = useState('');

  // A connection that could not be matched to a client lands here with ?error=. Show it once, then tidy the address.
  useEffect(() => {
    const message = new URLSearchParams(window.location.search).get('error');
    if (message) {
      setReturned(message);
      window.history.replaceState(null, '', '/admin');
    }
  }, []);

  return (
    <div>
      <section className="page-intro">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>All clients</h1>
          <p>What needs a person today, across every client.</p>
        </div>
        <div className="page-intro-actions"><Link className="btn btn-ghost" href="/admin/clients"><Icon name="grid" size={14} /> All clients</Link></div>
      </section>

      {returned && <ErrorNotice message={returned} />}
      {error && <ErrorNotice message={error} onRetry={() => void reload()} busy={loading} />}
      {loading && !data && <SkeletonRows count={3} label="Loading overview" />}

      {data && (
        <>
          <div className="adm-tiles">
            <Tile label="Clients" value={data.clients.active + data.clients.suspended} hint={`${data.clients.active} active, ${data.clients.suspended} suspended`} />
            <Tile label="Channels needing attention" value={data.channels.disconnected} hint={`${data.channels.connected} connected`} bad />
            <Tile label="Failed posts" value={data.posts.failed} hint={`${data.posts.scheduled} scheduled`} bad />
            <Tile label="Due in 24 hours" value={data.posts.dueWithin24h} hint="Posts about to go out" />
            <Tile label="Invites waiting" value={data.pendingInvites} hint="People who have not joined yet" />
          </div>

          <section className="card data-card" aria-labelledby="attention-title">
            <div className="card-header"><div><h2 className="card-title" id="attention-title">Needs attention <span className="list-count">{data.attention.length}</span></h2><p className="card-subtitle">Open a client to fix what is listed.</p></div></div>
            {data.attention.length === 0 ? (
              <EmptyBlock icon="check" title="All clear">Nothing needs attention right now.</EmptyBlock>
            ) : (
              <ul className="adm-attention">
                {data.attention.map((item) => (
                  <li key={item.clientId}>
                    <Link href={`/admin/clients/${item.clientId}?tab=${tabForReasons(item.reasons)}`} className="adm-attention-row">
                      <span className="adm-attention-main">
                        <strong>{item.name}</strong>
                        <span>{item.reasons.map(sentence).join('. ')}.</span>
                      </span>
                      <span className="adm-attention-count">{plural(item.reasons.length, 'issue')}</span>
                      <Icon name="chevron-right" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
