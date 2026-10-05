'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../components/Icons';
import { useConfirm } from '../../../components/ConfirmDialog';
import { busy, Check, CheckView, failToast, KIND_LABELS, shortDate, SimulationOn, StatusPill } from '../../../components/preflight/shared';
import { api } from '../../../lib/api';

export default function PreflightDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [check, setCheck] = useState<Check | null>(null);
  const [missing, setMissing] = useState(false);
  const [simulationOn, setSimulationOn] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => api<Check>(`/preflight/${params.id}`).then(setCheck).catch((error) => {
    setMissing(true);
    failToast(error, 'Could not load this check.');
  }), [params.id]);

  useEffect(() => {
    api<{ audienceSimulation: boolean }>('/preflight/status').then((s) => setSimulationOn(s.audienceSimulation)).catch(() => { /* progress copy only */ });
    load();
  }, [load]);

  // Comparisons have their own page.
  useEffect(() => { if (check?.groupId) router.replace(`/preflight/compare/${check.groupId}`); }, [check?.groupId, router]);

  const running = !!check && busy(check);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  const retry = async (id: string) => {
    try { setCheck(await api<Check>(`/preflight/${id}/retry`, { method: 'POST' })); } catch (error) { failToast(error, 'Could not retry.'); }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this check?', description: 'Its results are removed for good.', confirmLabel: 'Delete check', destructive: true }))) return;
    try { await api(`/preflight/${params.id}`, { method: 'DELETE' }); router.push('/preflight'); } catch (error) { failToast(error, 'Could not delete this check.'); }
  };

  return <SimulationOn.Provider value={simulationOn}><div>
    {confirmDialog}
    <div className="pf-detail-bar">
      <Link className="btn btn-ghost btn-sm" href="/preflight"><Icon name="arrow-left" size={14} /> All checks</Link>
      {check && <div className="pf-detail-meta">
        <span>{KIND_LABELS[check.kind]} · checked {shortDate(check.createdAt)}</span>
        <StatusPill check={check} />
        <button className="icon-btn" type="button" aria-label="Delete check" onClick={remove}><Icon name="trash" size={13} /></button>
      </div>}
    </div>
    <section className="card data-card" aria-live="polite">
      {check ? <CheckView check={check} onRetry={retry} onChanged={load} /> : <div className="empty-state" style={{ marginTop: 22 }}>{missing ? 'This check could not be found.' : 'Loading…'}</div>}
    </section>
  </div></SimulationOn.Provider>;
}
