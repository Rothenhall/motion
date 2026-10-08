'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../Icons';
import { API, api, authHeaders } from '../../lib/api';
import { useCan } from '../../lib/session';
import { NotOnHint } from '../FeatureGate';
import type { BrainMap } from './BrainViewer';
import type { BrainRegion } from './brainAnchors';
import { fmtClock } from '../../lib/format';
import { mediaSrc } from '../../lib/media';
import { plain } from '../../lib/text';

type Rating = 'WEAK' | 'OK' | 'STRONG';
export type Insight = { title: string; detail: string; fix: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; startSec: number | null; endSec: number | null; basis: string };
type Report = {
  verdict: string;
  hook: { rating: Rating; score: number; reason: string };
  dimensions: { key: string; rating: Rating; note: string }[];
  insights: Insight[];
  alternativeHooks: string[];
};
export type Simulation = {
  baseline: 'library' | 'clip';
  reference_label: string | null;
  seconds: number;
  curves: Record<string, number[]>;
  sound_off_attention: number[] | null;
  moments: { kind: string; start: number; end: number; level: number }[];
  facts: { short_clip: boolean };
};
export type Stage = 'SIMULATING' | 'WRITING';
export type Check = {
  id: string; groupId: string | null; label: string | null; kind: 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'TEXT'; platform: string;
  caption: string | null; text: string | null; mediaUrls: string[]; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  engine: string | null; error: string | null; createdAt: string; startedAt: string | null; completedAt?: string | null;
  brainStatus?: 'RUNNING' | 'FAILED' | null;
  signals?: { stage?: Stage; video?: { durationSec: number; hasAudio?: boolean }; simulation?: Simulation; simulationError?: string } | null;
  report?: Report | null;
  /** List rows only. */
  stage?: Stage | null;
  verdict?: string | null;
  hook?: { rating: Rating; score: number } | null;
};
export type Group = { groupId: string; done: boolean; rankedBy: string; ranking: { id: string; label: string | null; score: number }[] | null; checks: Check[] };

export const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
export const KIND_LABELS: Record<string, string> = { VIDEO: 'Reel', IMAGE: 'Image', CAROUSEL: 'Carousel', TEXT: 'Text post' };
export const DIMENSION_LABELS: Record<string, string> = { HOOK: 'Hook', CLARITY: 'Clarity', VISUALS: 'Visuals', PACING: 'Pacing', EMOTION: 'Emotional pull', SOUND_OFF: 'Works muted', CTA: 'Call to action' };
export const BASIS_LABELS: Record<string, string> = { AUDIENCE_SIMULATION: 'Audience simulation', VISUAL_REVIEW: 'Visual review', COPY_REVIEW: 'Copy review', YOUR_HISTORY: 'Your past posts' };
export const RATING_LABELS: Record<Rating, string> = { WEAK: 'Weak', OK: 'OK', STRONG: 'Strong' };
/** Whether the backend has the audience simulation (TRIBE) configured. */
export const SimulationOn = createContext(false);

export const isVideo = (url: string) => /\.(mp4|mov)(\?|$)/i.test(url);
export const clock = fmtClock;
export const span = (i: Insight) => i.startSec == null ? null : i.endSec != null && i.endSec > i.startSec ? `${clock(i.startSec)}–${clock(i.endSec)}` : clock(i.startSec);
export const busy = (c: Pick<Check, 'status'>) => c.status === 'PENDING' || c.status === 'RUNNING';
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
export const fixList = (r: Report) => r.insights.filter((i) => i.severity !== 'LOW').sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
export const fixesAsText = (r: Report) => fixList(r).map((i, n) => `${n + 1}. ${span(i) ? `[${span(i)}] ` : ''}${plain(i.title)}: ${plain(i.fix)}`).join('\n');
export const shortDate = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const failToast = (error: unknown, fallback: string) => toast.error(error instanceof Error ? error.message : fallback);

export async function uploadFiles(files: FileList): Promise<string[]> {
  const urls: string[] = [];
  for (const file of Array.from(files)) {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${API}/media/upload`, { method: 'POST', body, headers: authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Upload failed.');
    urls.push((await res.json()).url);
  }
  return urls;
}

export async function saveHook(text: string, platform: string) {
  try {
    await api('/hooks', { method: 'POST', body: JSON.stringify({ text, platform, category: 'CURIOSITY' }) });
    toast.success('Saved to your hook library');
  } catch (error) { failToast(error, 'Could not save this hook.'); }
}

/** Queued / Processing (with the current step) / Completed / Failed. */
export function StatusPill({ check }: { check: Pick<Check, 'status' | 'stage' | 'signals'> }) {
  const stage = check.stage ?? check.signals?.stage;
  if (check.status === 'PENDING') return <span className="status-pill status-draft">Queued</span>;
  if (check.status === 'RUNNING') return <span className="status-pill status-pending">{stage === 'SIMULATING' ? 'Processing · simulating viewers' : stage === 'WRITING' ? 'Processing · writing insights' : 'Processing'}</span>;
  if (check.status === 'FAILED') return <span className="status-pill status-failed">Failed</span>;
  return <span className="status-pill status-published">Completed</span>;
}

// three.js only runs in the browser.
const BrainViewer = dynamic(() => import('./BrainViewer'), { ssr: false, loading: () => <div className="pf-brain-empty">Loading the brain view…</div> });

export function CheckView({ check, onRetry, nested, onChanged }: { check: Check; onRetry: (id: string) => void; nested?: boolean; onChanged?: () => void }) {
  const canAi = useCan('ai'); // retrying runs the AI again
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const doneKey = `motion-fixes-${check.id}`;
  useEffect(() => {
    try { setDone(JSON.parse(window.localStorage.getItem(doneKey) || '{}')); } catch { setDone({}); }
  }, [doneKey]);
  const toggleFix = (n: number) => setDone((cur) => {
    const next = { ...cur, [n]: !cur[n] };
    try { window.localStorage.setItem(doneKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const sim = check.signals?.simulation;
  const seek = (sec: number) => { const v = videoRef.current; if (v) { v.currentTime = sec; v.play().catch(() => { /* autoplay blocked */ }); } };
  const Title = nested ? 'h4' : 'h3';

  if (busy(check)) return <Progress check={check} Title={Title} />;

  if (check.status === 'FAILED' || !check.report) return <div className="pf-body">
    <Title className="card-title">This check failed</Title>
    <p className="card-subtitle">{check.error || 'Something went wrong.'}</p>
    <div className="form-actions" style={{ marginTop: 12 }}><button className="btn btn-sm" type="button" onClick={() => onRetry(check.id)} disabled={!canAi}>Try again</button>{!canAi && <NotOnHint />}</div>
  </div>;

  const r = check.report;
  const fixes = fixList(r);
  const keeps = r.insights.filter((i) => i.severity === 'LOW');
  const reel = check.kind === 'VIDEO' && check.mediaUrls[0];
  const copyFixes = () => {
    navigator.clipboard?.writeText(fixesAsText(r)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* clipboard blocked */ });
  };
  return <div className="pf-body">
    <div className="idea-meta">
      {check.label && <span className="tag">{check.label}</span>}
      <span className="tag">{KIND_LABELS[check.kind]}</span>
      <span className="tag">{PLATFORMS.find((p) => p.id === check.platform)?.label}</span>
      <span className="tag tag-brand">{check.engine === 'AUDIENCE_SIMULATION' ? 'Audience simulation + AI review' : 'AI review'}</span>
      <span className="tag tag-muted">Estimate</span>
    </div>
    <Title className="pf-verdict">{plain(r.verdict)}</Title>

    {reel && <div className={`pf-media ${sim ? 'pf-media-split' : ''}`}>
      <figure className="pf-media-cell">
        <figcaption className="pf-media-label">Your reel</figcaption>
        <video ref={videoRef} className="pf-video" src={`${mediaSrc(check.mediaUrls[0])}#t=0.1`} controls playsInline preload="metadata" onTimeUpdate={(e) => setNow((e.target as HTMLVideoElement).currentTime)} onSeeked={(e) => setNow((e.target as HTMLVideoElement).currentTime)} />
      </figure>
      {sim && <BrainPanel check={check} now={now} onChanged={onChanged} />}
    </div>}
    {check.kind !== 'VIDEO' && check.mediaUrls.length > 0 && <div className="pf-images">{check.mediaUrls.map((u, i) => <img key={u} src={mediaSrc(u)} alt={check.kind === 'CAROUSEL' ? `Slide ${i + 1}` : 'Your image'} loading="lazy" />)}</div>}
    {sim && <AttentionChart sim={sim} now={now} onSeek={seek} />}
    {check.signals?.simulationError && <p className="form-hint">Audience simulation unavailable for this check ({check.signals.simulationError}). Insights come from the AI review.</p>}

    <div className="pf-scores">
      <div className={`pf-score pf-${r.hook.rating.toLowerCase()}`}><span>Hook</span><strong>{RATING_LABELS[r.hook.rating]} <em className="pf-score-num">{Math.round(r.hook.score)}/100</em></strong><small>{r.hook.reason}</small></div>
      {r.dimensions.filter((d) => d.key !== 'HOOK').map((d) => <div className={`pf-score pf-${d.rating.toLowerCase()}`} key={d.key}><span>{DIMENSION_LABELS[d.key] || d.key}</span><strong>{RATING_LABELS[d.rating]}</strong><small>{d.note}</small></div>)}
    </div>

    {fixes.length > 0 && <>
      <div className="pf-section-row">
        <h4 className="pf-section">Fix before posting <span className="list-count">{fixes.filter((_, n) => done[n]).length}/{fixes.length}</span></h4>
        <button className="btn btn-ghost btn-sm" type="button" onClick={copyFixes}><Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy fix list'}</button>
      </div>
      <ul className="pf-insights">{fixes.map((i, n) => <InsightItem key={n} insight={i} video={check.kind === 'VIDEO'} onSeek={seek} done={!!done[n]} onToggle={() => toggleFix(n)} />)}</ul>
    </>}
    {keeps.length > 0 && <>
      <h4 className="pf-section">Already working</h4>
      <ul className="pf-insights">{keeps.map((i, n) => <InsightItem key={n} insight={i} video={check.kind === 'VIDEO'} onSeek={seek} />)}</ul>
    </>}

    {r.alternativeHooks.length > 0 && <>
      <h4 className="pf-section">Stronger openings to try</h4>
      <ul className="pf-hooks">{r.alternativeHooks.map((h) => <li key={h}><span>&ldquo;{plain(h)}&rdquo;</span>
        <button className="btn btn-sm btn-soft" type="button" onClick={() => saveHook(h, check.platform)}><Icon name="star" size={13} /> Save</button>
        <button className="icon-btn" type="button" aria-label="Copy hook" onClick={() => navigator.clipboard?.writeText(h)}><Icon name="copy" size={13} /></button>
      </li>)}</ul>
    </>}

    <p className="form-hint pf-disclaimer">These are predictions, not guarantees. {check.engine === 'AUDIENCE_SIMULATION' ? 'The attention curve and brain view come from a research model of how an average viewer processes video, not from measuring real people; they have not yet been checked against your real results.' : 'They come from an AI review of your post and your past performance.'}</p>
  </div>;
}

type BrainState = { kind: 'loading' } | { kind: 'ready'; brain: BrainMap } | { kind: 'missing' } | { kind: 'needs-run' } | { kind: 'running' } | { kind: 'failed'; message: string };

/** The simulated brain response next to the video, or a way to fill it in for checks made before it was stored. */
export function BrainPanel({ check, now, onChanged, bare = false, regions }: { check: Check; now: number; onChanged?: () => void; bare?: boolean; regions?: BrainRegion[] }) {
  const [state, setState] = useState<BrainState>({ kind: 'loading' });
  const canAi = useCan('ai'); // loading a brain view can start a new simulation
  const [asking, setAsking] = useState(false);

  const fetchBrain = useCallback(async (): Promise<boolean> => {
    try {
      setState({ kind: 'ready', brain: await api<BrainMap>(`/preflight/${check.id}/brain`) });
      return true;
    } catch { return false; }
  }, [check.id]);

  useEffect(() => {
    let stop = false;
    (async () => {
      if (await fetchBrain() || stop) return;
      setState(check.brainStatus === 'RUNNING' ? { kind: 'running' } : check.brainStatus === 'FAILED' ? { kind: 'failed', message: 'The last attempt to build the brain view failed.' } : { kind: 'missing' });
    })();
    return () => { stop = true; };
  }, [fetchBrain, check.brainStatus]);

  // A fresh run finishes in the background: poll until the map is stored.
  useEffect(() => {
    if (state.kind !== 'running') return;
    const timer = setInterval(async () => {
      if (await fetchBrain()) { clearInterval(timer); onChanged?.(); return; }
      const latest = await api<Check>(`/preflight/${check.id}`).catch(() => null);
      if (latest?.brainStatus === 'FAILED') { clearInterval(timer); setState({ kind: 'failed', message: 'Building the brain view failed.' }); }
    }, 10000);
    return () => clearInterval(timer);
  }, [state.kind, fetchBrain, check.id, onChanged]);

  const load = async (allowFresh: boolean) => {
    setAsking(true);
    try {
      const { status } = await api<{ status: 'READY' | 'NEEDS_RUN' | 'RUNNING' }>(`/preflight/${check.id}/brain`, { method: 'POST', body: JSON.stringify({ allowFresh }) });
      if (status === 'READY') await fetchBrain();
      else setState({ kind: status === 'RUNNING' ? 'running' : 'needs-run' });
    } catch (error) { failToast(error, 'Could not load the brain view.'); }
    finally { setAsking(false); }
  };

  return <figure className={`pf-media-cell ${bare ? 'pf-bare' : ''}`}>
    <figcaption className="pf-media-label">Simulated brain response <span>predicted average viewer</span></figcaption>
    {state.kind === 'ready' && <BrainViewer brain={state.brain} time={now} bare={bare} regions={regions} />}
    {state.kind === 'loading' && <div className="pf-brain-empty">Loading the brain view…</div>}
    {state.kind === 'missing' && <div className="pf-brain-empty">
      <strong>No brain view stored for this check</strong>
      <span>It was checked before brain views were saved. If the simulation still has this reel cached, it loads for free, in seconds, or up to 2 minutes if the simulation service is waking up.</span>
      <button className="btn btn-sm" type="button" disabled={asking || !canAi} onClick={() => load(false)}>{asking ? 'Checking…' : 'Load brain view'}</button>
    </div>}
    {state.kind === 'needs-run' && <div className="pf-brain-empty">
      <strong>This reel needs a fresh simulation</strong>
      <span>It is no longer cached. Building the brain view runs the model again on a GPU (about 10–16 minutes, a small Modal cost). Your insights stay as they are.</span>
      <button className="btn btn-sm" type="button" disabled={asking || !canAi} onClick={() => load(true)}>{asking ? 'Starting…' : 'Run the simulation'}</button>
    </div>}
    {state.kind === 'running' && <div className="pf-brain-empty"><strong>Building the brain view…</strong><span>This takes about 10–16 minutes. You can leave this page; it will be here when you come back.</span></div>}
    {state.kind === 'failed' && <div className="pf-brain-empty">
      <strong>{state.message}</strong>
      <button className="btn btn-sm" type="button" disabled={asking || !canAi} onClick={() => load(true)}>Try again</button>
    </div>}
  </figure>;
}

function InsightItem({ insight: i, video, onSeek, done, onToggle }: { insight: Insight; video: boolean; onSeek: (s: number) => void; done?: boolean; onToggle?: () => void }) {
  return <li className={`pf-insight sev-${i.severity.toLowerCase()} ${done ? 'is-done' : ''}`}>
    <div className="pf-insight-head">
      {onToggle && <button type="button" className={`pf-tick ${done ? 'on' : ''}`} role="checkbox" aria-checked={!!done} aria-label={`Mark fixed: ${i.title}`} onClick={onToggle}>{done && <Icon name="check" size={11} />}</button>}
      {i.severity !== 'LOW' && <span className={`pf-sev pf-sev-${i.severity.toLowerCase()}`}>{i.severity === 'HIGH' ? 'Fix first' : 'Worth fixing'}</span>}
      <strong>{plain(i.title)}</strong>
      {span(i) && (video ? <button type="button" className="pf-time" onClick={() => onSeek(i.startSec!)} aria-label={`Play from ${clock(i.startSec!)}`}><Icon name="play" size={11} /> {span(i)}</button> : <span className="pf-time">{span(i)}</span>)}
      <span className="tag tag-muted">{BASIS_LABELS[i.basis] || i.basis}</span>
    </div>
    <p>{plain(i.detail)}</p>
    <p className="pf-fix"><strong>{i.severity === 'LOW' ? 'Tip:' : 'Fix:'}</strong> {plain(i.fix)}</p>
  </li>;
}

/** Reel checks with the audience simulation take 10–16 minutes, so show where the check is and that it is safe to leave. */
function Progress({ check, Title }: { check: Check; Title: 'h3' | 'h4' }) {
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);
  const stage = check.status === 'PENDING' ? 'QUEUED' : check.signals?.stage === 'WRITING' ? 'WRITING' : check.signals?.stage === 'SIMULATING' ? 'SIMULATING' : 'READING';
  const simulated = useContext(SimulationOn) && check.kind === 'VIDEO';
  const steps = [
    { key: 'QUEUED', label: 'Queued' },
    { key: 'READING', label: check.kind === 'VIDEO' ? 'Reading frames, cuts and sound' : 'Reading your post' },
    ...(simulated ? [{ key: 'SIMULATING', label: 'Simulating how viewers react, second by second' }] : []),
    { key: 'WRITING', label: 'Writing your insights and fixes' },
  ];
  const at = Math.max(0, steps.findIndex((s) => s.key === stage));
  const since = check.startedAt ? Math.max(0, Math.floor((tick - new Date(check.startedAt).getTime()) / 1000)) : null;
  return <div className="pf-body">
    <Title className="card-title">{check.label ? `${check.label}: checking…` : 'Checking your post…'}</Title>
    <p className="card-subtitle">{check.kind === 'VIDEO' && simulated
      ? 'Reels usually take 10 to 15 minutes, mostly for the audience simulation. You can leave this page; the check stays in your list and shows Completed when it is ready.'
      : 'This usually takes under a minute.'}</p>
    <ol className="pf-steps" aria-label="Progress">
      {steps.map((s, i) => <li key={s.key} className={i < at ? 'done' : i === at ? 'active' : ''} aria-current={i === at ? 'step' : undefined}>
        <span className="pf-step-dot" aria-hidden="true">{i < at ? <Icon name="check" size={11} /> : null}</span>
        <span>{s.label}</span>
        {i === at && since != null && <span className="pf-step-time">{clock(since)}</span>}
      </li>)}
    </ol>
  </div>;
}

function AttentionChart({ sim, now, onSeek }: { sim: Simulation; now: number; onSeek: (s: number) => void }) {
  const attention = sim.curves.attention_index || [];
  const muted = sim.sound_off_attention;
  const n = attention.length;
  if (n < 2) return null;
  const W = 600, H = 160, P = 24;
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => 8 + (1 - v / 100) * (H - 30);
  const line = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const drops = sim.moments.filter((m) => m.kind === 'drop_risk');
  const step = Math.max(1, Math.ceil(n / 8));
  const typical = sim.baseline === 'library' ? `similar reels${sim.reference_label ? ` (${sim.reference_label})` : ''}` : 'the rest of this video';

  return <figure className="pf-chart">
    <figcaption><strong>Predicted attention</strong><span>50 = typical for {typical}. Click to jump.</span></figcaption>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted viewer attention over the video" onClick={(e) => {
      const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const sec = Math.round((((e.clientX - box.left) / box.width) * W - P) / (W - 2 * P) * (n - 1));
      onSeek(Math.max(0, Math.min(n - 1, sec)));
    }}>
      {drops.map((d) => <rect key={d.start} className="pf-drop-zone" x={x(d.start)} width={Math.max(4, x(Math.min(d.end, n - 1)) - x(d.start))} y={4} height={H - 26} />)}
      <rect className="pf-hook-zone" x={x(0)} width={x(Math.min(3, n - 1)) - x(0)} y={4} height={H - 26} />
      <line className="chart-grid-line" x1={P} x2={W - P} y1={y(50)} y2={y(50)} strokeDasharray="4 4" />
      {muted && <path className="pf-line-muted" d={line(muted)} />}
      <path className="chart-line" d={line(attention)} />
      <line className="pf-now" x1={x(Math.min(now, n - 1))} x2={x(Math.min(now, n - 1))} y1={4} y2={H - 22} />
      {attention.map((_, i) => i % step === 0 && <text key={i} className="chart-label" x={x(i)} y={H - 6} textAnchor="middle">{clock(i)}</text>)}
    </svg>
    <div className="chart-legend">
      <span className="legend-item"><i className="legend-dot" style={{ background: 'var(--brand-600)' }} /> With sound</span>
      {muted && <span className="legend-item"><i className="legend-dot" style={{ background: 'var(--text-3)' }} /> Muted autoplay</span>}
      <span className="legend-item"><i className="legend-dot" style={{ background: 'var(--brand-100)' }} /> Hook (0–3s)</span>
      {drops.length > 0 && <span className="legend-item"><i className="legend-dot" style={{ background: 'var(--danger-bg)' }} /> Likely drop-off</span>}
    </div>
    {sim.facts.short_clip && <p className="form-hint">Short clips give a rougher read.</p>}
  </figure>;
}

export function GroupView({ group, onRetry }: { group: Group; onRetry: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = group.checks.find((c) => c.id === open) || (group.ranking ? group.checks.find((c) => c.id === group.ranking![0]?.id) : null) || group.checks[0];
  return <div>
    <div className="card-header"><div><h3 className="card-title">Version comparison</h3><p className="card-subtitle">{group.done ? (group.rankedBy === 'AUDIENCE_SIMULATION' ? 'Ranked by predicted attention in the first 3 seconds.' : 'Ranked by how strongly each version opens.') : 'Checking each version…'}</p></div></div>
    <ol className="pf-ranking">
      {(group.ranking || group.checks.map((c) => ({ id: c.id, label: c.label, score: null as number | null }))).map((r, i) => {
        const c = group.checks.find((x) => x.id === r.id)!;
        return <li key={r.id}><button type="button" className={`pf-rank ${shown?.id === r.id ? 'active' : ''}`} onClick={() => setOpen(r.id)}>
          <span className="pf-rank-pos">{group.ranking ? i + 1 : '·'}</span>
          <span className="pf-rank-copy"><strong>{r.label}{group.ranking && i === 0 ? ' · best opening' : ''}</strong><span>{busy(c) ? 'Checking…' : c.status === 'FAILED' ? 'Failed' : c.report?.verdict}</span></span>
          {r.score != null && <span className="pf-rank-score">{r.score}</span>}
        </button></li>;
      })}
    </ol>
    {group.checks.filter((c) => c.status === 'FAILED' && !group.ranking?.some((r) => r.id === c.id)).map((c) => <p className="form-hint pf-pad" key={c.id}>{c.label} could not be checked.</p>)}
    {shown && <CheckView check={shown} onRetry={onRetry} nested />}
  </div>;
}
