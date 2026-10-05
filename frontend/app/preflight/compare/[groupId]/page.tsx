'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../../../components/Icons';
import { failToast, Group, GroupView, SimulationOn } from '../../../../components/preflight/shared';
import { api } from '../../../../lib/api';

export default function PreflightCompare({ params }: { params: { groupId: string } }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [missing, setMissing] = useState(false);
  const [simulationOn, setSimulationOn] = useState(false);

  const load = useCallback(() => api<Group>(`/preflight/groups/${params.groupId}`).then(setGroup).catch((error) => {
    setMissing(true);
    failToast(error, 'Could not load this comparison.');
  }), [params.groupId]);

  useEffect(() => {
    api<{ audienceSimulation: boolean }>('/preflight/status').then((s) => setSimulationOn(s.audienceSimulation)).catch(() => { /* progress copy only */ });
    load();
  }, [load]);

  const running = !!group && !group.done;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  const retry = async (id: string) => {
    try { await api(`/preflight/${id}/retry`, { method: 'POST' }); load(); } catch (error) { failToast(error, 'Could not retry.'); }
  };

  return <SimulationOn.Provider value={simulationOn}><div>
    <div className="pf-detail-bar"><Link className="btn btn-ghost btn-sm" href="/preflight"><Icon name="arrow-left" size={14} /> All checks</Link></div>
    <section className="card data-card" aria-live="polite">
      {group ? <GroupView group={group} onRetry={retry} /> : <div className="empty-state" style={{ marginTop: 22 }}>{missing ? 'This comparison could not be found.' : 'Loading…'}</div>}
    </section>
  </div></SimulationOn.Provider>;
}
