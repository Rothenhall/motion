'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icons';
import ApprovalCard from '@/components/approvals/ApprovalCard';
import { Select } from '@/components/ui/select';
import { listApprovals, type ApprovalItem } from '@/lib/approvals';
import { errorText } from '@/lib/format';
import '@/components/approvals/approvals.css';

/** Posts from every client that wait for a decision, oldest first. */
export default function ApprovalsQueue() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await listApprovals();
      setItems(res?.items ?? []);
    } catch (e) {
      setError(errorText(e, 'Could not load the approval queue.'));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const clients = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items) map.set(i.client.id, i.client.name);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);
  // A filter for a client with nothing left falls back to everyone.
  const activeClient = clients.some((c) => c.id === clientId) ? clientId : '';
  const shown = activeClient ? items.filter((i) => i.client.id === activeClient) : items;

  const remove = (item: ApprovalItem) => setItems((list) => list.filter((i) => i.id !== item.id));

  return (
    <div className="ap-page">
      <section className="page-intro">
        <div>
          <div className="eyebrow">Review</div>
          <h1>Approvals</h1>
          <p>Posts your clients&rsquo; teams have submitted. Approve them to schedule, or ask for changes.</p>
        </div>
        {!loading && !error && <span className="list-count">{shown.length} waiting</span>}
      </section>

      {!loading && !error && clients.length > 1 && (
        <div className="ap-toolbar">
          <Select value={activeClient} onChange={(e) => setClientId(e.target.value)} aria-label="Filter by client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" size={15} /> <span style={{ flex: 1 }}>{error}</span>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setLoading(true); void load(); }}>Try again</button>
        </div>
      )}

      {loading ? (
        <div className="ap-list" aria-busy="true" aria-label="Loading approvals">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton ap-skel" aria-hidden="true" />)}
        </div>
      ) : !error && shown.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="empty-icon"><Icon name="check" size={18} /></div><strong>Nothing is waiting for approval</strong>New submissions show up here.</div></div>
      ) : (
        <ul className="ap-list" aria-label="Posts waiting for approval">
          {shown.map((item) => <ApprovalCard key={item.id} item={item} onDone={remove} onStale={() => void load()} />)}
        </ul>
      )}
    </div>
  );
}
