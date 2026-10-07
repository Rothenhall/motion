'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/Icons';
import ApprovalCard from '@/components/approvals/ApprovalCard';
import { clientApprovals, type ApprovalItem } from '@/lib/approvals';
import { errorText } from '@/lib/format';
import '@/components/approvals/approvals.css';

/** The Approvals tab on a client's page: what waits for a decision, and what was decided lately. */
export default function ApprovalsTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<{ pending: ApprovalItem[]; recent: ApprovalItem[] } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setData(await clientApprovals(clientId)); }
    catch (e) { setError(errorText(e, 'Could not load approvals for this client.')); }
  }, [clientId]);
  useEffect(() => { setData(null); void load(); }, [load]);

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        <Icon name="alert" size={15} /> <span style={{ flex: 1 }}>{error}</span>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) {
    return <div className="ap-list" aria-busy="true" aria-label="Loading approvals">{[0, 1].map((i) => <div key={i} className="skeleton ap-skel" aria-hidden="true" />)}</div>;
  }

  const { pending, recent } = data;
  return (
    <div>
      <h2 className="ap-section-title">Waiting for approval</h2>
      {pending.length === 0 ? (
        <div className="card"><div className="empty-state"><div className="empty-icon"><Icon name="check" size={18} /></div><strong>Nothing is waiting for approval</strong>New submissions from this client show up here.</div></div>
      ) : (
        <ul className="ap-list" aria-label="Posts waiting for approval">
          {pending.map((item) => <ApprovalCard key={item.id} item={item} showClient={false} onDone={(done) => setData((d) => d && ({ pending: d.pending.filter((i) => i.id !== done.id), recent: d.recent }))} onStale={() => void load()} />)}
        </ul>
      )}
      {recent.length > 0 && (
        <details className="ap-more">
          <summary>Recently decided ({recent.length})</summary>
          <ul className="ap-list">
            {recent.map((item) => <ApprovalCard key={item.id} item={item} showClient={false} decided />)}
          </ul>
        </details>
      )}
    </div>
  );
}
