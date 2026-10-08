'use client';

import { useMemo, useState } from 'react';
import { exactTime, getAudit, getTeam, timeAgo, AuditEntry } from '../../lib/admin';
import { ACTIVITY_FILTERS, ActivityFilter, describeActivity, matchesFilter } from './activity';
import { EmptyBlock, ErrorNotice, SkeletonRows } from './Feedback';
import { useLoad } from './hooks';
import type { ClientTabProps } from './types';

const PAGE = 25;

export default function ActivityTab({ client }: ClientTabProps) {
  const log = useLoad<AuditEntry[]>(() => getAudit(client.id), [client.id]);
  // Names for the people the entries are about. If this fails the sentences still read fine, just less specific.
  const team = useLoad(() => getTeam(client.id).catch(() => null), [client.id]);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [shown, setShown] = useState(PAGE);

  const people = useMemo(() => Object.fromEntries((team.data?.members ?? []).map((m) => [m.id, m.email])), [team.data]);
  const entries = (log.data ?? []).filter((e) => matchesFilter(e, filter));
  const visible = entries.slice(0, shown);

  return (
    <section className="card data-card" aria-labelledby="activity-title">
      <div className="card-header"><div><h2 className="card-title" id="activity-title">Activity</h2><p className="card-subtitle">What staff and the client&apos;s people did here, newest first.</p></div></div>
      <div className="adm-toolbar" role="group" aria-label="Filter activity">
        <div className="adm-filters">
          {ACTIVITY_FILTERS.map((f) => (
            <button key={f.id} type="button" className={`toolbar-filter ${filter === f.id ? 'active' : ''}`} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setShown(PAGE); }}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="adm-pad">
        {log.error && !log.data && <ErrorNotice message={log.error} onRetry={() => void log.reload()} busy={log.loading} />}
        {!log.data && !log.error && <SkeletonRows count={4} label="Loading activity" />}
        {log.data && entries.length === 0 && <EmptyBlock icon="clock" title={filter === 'all' ? 'No activity yet' : 'Nothing here'}>{filter === 'all' ? 'Changes to this client will show up here.' : 'Try another filter.'}</EmptyBlock>}
        {visible.length > 0 && (
          <ul className="adm-feed">
            {visible.map((e) => (
              <li key={e.id}>
                <span className="adm-feed-text">{describeActivity(e, people)}</span>
                <time dateTime={e.at} title={exactTime(e.at)}>{timeAgo(e.at)}</time>
              </li>
            ))}
          </ul>
        )}
        {entries.length > shown && (
          <div className="form-actions"><button className="btn btn-ghost btn-sm" type="button" onClick={() => setShown((n) => n + PAGE)}>Load more</button></div>
        )}
        {log.data && log.data.length >= 100 && entries.length <= shown && <p className="form-hint">Showing the latest 100 entries.</p>}
      </div>
    </section>
  );
}
