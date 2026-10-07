'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { useConfirm } from '../../components/ConfirmDialog';
import { NewCheckDialog, Prefill } from '../../components/preflight/NewCheckDialog';
import { busy, Check, failToast, KIND_LABELS, PLATFORMS, shortDate, StatusPill } from '../../components/preflight/shared';
import { NotOnHint } from '../../components/FeatureGate';
import { api } from '../../lib/api';
import { useCan } from '../../lib/session';
import { plain } from '../../lib/text';

/** One list row: a single check, or every version of a comparison folded together. */
type Row = { key: string; href: string; title: string; detail: string; platform: string; createdAt: string; status: Pick<Check, 'status' | 'stage'>; hook: number | null; ids: string[] };

function rows(checks: Check[]): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const c of checks) {
    if (c.groupId) {
      if (seen.has(c.groupId)) continue;
      seen.add(c.groupId);
      const versions = checks.filter((x) => x.groupId === c.groupId);
      const running = versions.find(busy);
      out.push({
        key: c.groupId, href: `/preflight/compare/${c.groupId}`,
        title: `Comparing ${versions.length} versions`,
        detail: versions.map((v) => v.label).filter(Boolean).join(' vs ') || KIND_LABELS[c.kind],
        platform: c.platform, createdAt: c.createdAt,
        status: running ? running : { status: versions.every((v) => v.status === 'FAILED') ? 'FAILED' : 'DONE' },
        hook: null, ids: versions.map((v) => v.id),
      });
    } else {
      out.push({
        key: c.id, href: `/preflight/${c.id}`,
        title: c.label || plain(c.verdict) || (busy(c) ? `${KIND_LABELS[c.kind]} check` : c.status === 'FAILED' ? 'Check failed' : 'Untitled check'),
        detail: c.label && c.verdict ? plain(c.verdict) : KIND_LABELS[c.kind],
        platform: c.platform, createdAt: c.createdAt, status: c, hook: c.hook ? Math.round(c.hook.score) : null, ids: [c.id],
      });
    }
  }
  return out;
}

export default function PreflightList() {
  const canAi = useCan('ai'); // running a check uses the AI
  const router = useRouter();
  const [status, setStatus] = useState({ ai: true, audienceSimulation: false });
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => api<Check[]>('/preflight').then(setChecks).catch((error) => { setChecks((c) => c ?? []); failToast(error, 'Could not load your checks.'); }), []);

  useEffect(() => {
    api('/preflight/status').then(setStatus).catch(() => { /* shown when queueing */ });
    load();
    const params = new URLSearchParams(window.location.search);
    // Old links: /preflight?id=... and ?group=...
    if (params.get('id')) { router.replace(`/preflight/${params.get('id')}`); return; }
    if (params.get('group')) { router.replace(`/preflight/compare/${params.get('group')}`); return; }
    // From the composer: /preflight?media=<url>&caption=...&platform=...
    const media = params.getAll('media').filter(Boolean);
    if (media.length || params.get('caption')) {
      setPrefill({ mediaUrls: media, caption: params.get('caption') || '', platform: params.get('platform') || 'instagram' });
      setDialogOpen(true);
    }
  }, [load, router]);

  // Keep statuses moving while anything is queued or processing.
  const anyBusy = !!checks?.some(busy);
  useEffect(() => {
    if (!anyBusy) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [anyBusy, load]);

  const remove = async (row: Row) => {
    if (!(await confirm({ title: row.ids.length > 1 ? 'Delete this comparison?' : 'Delete this check?', description: 'Its results are removed for good.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      for (const id of row.ids) await api(`/preflight/${id}`, { method: 'DELETE' });
      setChecks((all) => (all || []).filter((c) => !row.ids.includes(c.id)));
    } catch (error) { failToast(error, 'Could not delete this check.'); }
  };

  const list = checks ? rows(checks) : [];

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Before you post</div><h1>Pre-flight check</h1><p>See how people will likely react to a reel before it goes live: predicted attention, a simulated brain response and the fixes to make.</p></div>
      <div className="page-intro-actions">
        <span className={status.audienceSimulation ? 'live-pill' : 'status-pill status-draft'} role="status">{status.audienceSimulation && <i aria-hidden="true" />}{status.audienceSimulation ? 'Audience simulation on' : 'AI review'}</span>
        <button className="btn" type="button" onClick={() => { setPrefill(null); setDialogOpen(true); }} disabled={!status.ai || !canAi} aria-describedby={canAi ? undefined : 'pf-ai-off'}><Icon name="plus" size={15} /> New reel check</button>
        {!canAi && <NotOnHint id="pf-ai-off" />}
      </div>
    </section>

    {!status.ai && <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> AI is not set up yet. Add OPENROUTER_API_KEY to backend/.env and restart the backend.</div>}
    {confirmDialog}
    <NewCheckDialog open={dialogOpen} onOpenChange={setDialogOpen} onQueued={load} aiReady={status.ai} prefill={prefill} />

    <section className="card data-card" aria-labelledby="pf-list-title">
      <div className="card-header"><div><h2 className="card-title" id="pf-list-title">Your checks <span className="list-count">{list.length}</span></h2><p className="card-subtitle">Click a completed check to see the reel, the brain view, the verdict and the fixes.</p></div></div>
      {checks === null ? <div className="empty-state">Loading…</div> : list.length === 0 ? <div className="empty-state">
        <div className="empty-icon"><Icon name="gauge" size={18} /></div>
        <strong>No checks yet</strong>
        Upload a reel to see how viewers will likely react before you post it.
        <button className="btn btn-sm" type="button" style={{ marginTop: 12 }} onClick={() => setDialogOpen(true)} disabled={!status.ai || !canAi}><Icon name="plus" size={13} /> New reel check</button>
      </div> : <div className="table-wrap">
        <table className="data-table pf-table">
          <thead><tr><th scope="col">Post</th><th scope="col">Platform</th><th scope="col">Checked</th><th scope="col">Status</th><th scope="col">Hook</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list.map((row) => <tr key={row.key} className="pf-row" onClick={() => router.push(row.href)}>
              <td>
                <a className="pf-row-title" href={row.href} onClick={(e) => { e.preventDefault(); router.push(row.href); }}>{row.title}</a>
                <span className="pf-row-detail">{row.detail}</span>
              </td>
              <td>{PLATFORMS.find((p) => p.id === row.platform)?.label}</td>
              <td className="pf-row-date">{shortDate(row.createdAt)}</td>
              <td><StatusPill check={row.status} /></td>
              <td>{row.hook != null ? <strong>{row.hook}</strong> : <span className="pf-row-detail">n/a</span>}</td>
              <td className="pf-row-actions"><button className="icon-btn" type="button" aria-label="Delete" onClick={(e) => { e.stopPropagation(); remove(row); }}><Icon name="trash" size={13} /></button></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </section>
  </div>;
}
