'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icons';
import { API, api, authHeaders } from '../../lib/api';

type Rating = 'WEAK' | 'OK' | 'STRONG';
type Insight = { title: string; detail: string; fix: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; startSec: number | null; endSec: number | null; basis: string };
type Report = {
  verdict: string;
  hook: { rating: Rating; score: number; reason: string };
  dimensions: { key: string; rating: Rating; note: string }[];
  insights: Insight[];
  alternativeHooks: string[];
};
type Simulation = {
  baseline: 'library' | 'clip';
  reference_label: string | null;
  seconds: number;
  curves: Record<string, number[]>;
  sound_off_attention: number[] | null;
  moments: { kind: string; start: number; end: number; level: number }[];
  facts: { short_clip: boolean };
};
type Check = {
  id: string; groupId: string | null; label: string | null; kind: 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'TEXT'; platform: string;
  caption: string | null; text: string | null; mediaUrls: string[]; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  engine: string | null; error: string | null; createdAt: string;
  signals?: { video?: { durationSec: number }; simulation?: Simulation; simulationError?: string } | null;
  report?: Report | null;
  verdict?: string | null;
};
type Group = { groupId: string; done: boolean; rankedBy: string; ranking: { id: string; label: string | null; score: number }[] | null; checks: Check[] };
type Draft = { mediaUrls: string[]; text: string };

const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime';
const DIMENSION_LABELS: Record<string, string> = { HOOK: 'Hook', CLARITY: 'Clarity', VISUALS: 'Visuals', PACING: 'Pacing', EMOTION: 'Emotional pull', SOUND_OFF: 'Works muted', CTA: 'Call to action' };
const BASIS_LABELS: Record<string, string> = { AUDIENCE_SIMULATION: 'Audience simulation', VISUAL_REVIEW: 'Visual review', COPY_REVIEW: 'Copy review', YOUR_HISTORY: 'Your past posts' };
const RATING_LABELS: Record<Rating, string> = { WEAK: 'Weak', OK: 'OK', STRONG: 'Strong' };
const KIND_LABELS: Record<string, string> = { VIDEO: 'Reel', IMAGE: 'Image', CAROUSEL: 'Carousel', TEXT: 'Text post' };
const emptyDraft = (): Draft => ({ mediaUrls: [], text: '' });

const isVideo = (url: string) => /\.(mp4|mov)(\?|$)/i.test(url);
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const span = (i: Insight) => i.startSec == null ? null : i.endSec != null && i.endSec > i.startSec ? `${clock(i.startSec)}–${clock(i.endSec)}` : clock(i.startSec);
const busy = (c: Check) => c.status === 'PENDING' || c.status === 'RUNNING';

async function uploadFiles(files: FileList): Promise<string[]> {
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

export default function Preflight() {
  const [status, setStatus] = useState({ ai: true, audienceSimulation: false });
  const [history, setHistory] = useState<Check[]>([]);
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<{ type: 'check' | 'group'; id: string } | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  const fail = (error: unknown, fallback: string) => setNotice({ kind: 'error', text: error instanceof Error ? error.message : fallback });
  const loadHistory = useCallback(() => api<Check[]>('/preflight').then(setHistory).catch(() => { /* list is secondary */ }), []);

  useEffect(() => {
    api('/preflight/status').then(setStatus).catch(() => { /* shown on submit */ });
    loadHistory();
    // Prefill from the composer: /preflight?media=<url>&caption=...&platform=...
    const params = new URLSearchParams(window.location.search);
    const media = params.getAll('media').filter(Boolean);
    if (media.length || params.get('caption')) setDrafts([{ mediaUrls: media, text: '' }]);
    if (params.get('caption')) setCaption(params.get('caption') || '');
    if (params.get('platform')) setPlatform(params.get('platform') || 'instagram');
    if (params.get('id')) setSelected({ type: 'check', id: params.get('id')! });
    if (params.get('group')) setSelected({ type: 'group', id: params.get('group')! });
  }, [loadHistory]);

  // Load the selected result, and keep polling while it is still running.
  useEffect(() => {
    if (!selected) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (selected.type === 'check') {
          const next = await api<Check>(`/preflight/${selected.id}`);
          if (stop) return;
          setCheck(next); setGroup(null);
          if (busy(next)) timer = setTimeout(tick, 3000); else loadHistory();
        } else {
          const next = await api<Group>(`/preflight/groups/${selected.id}`);
          if (stop) return;
          setGroup(next); setCheck(null);
          if (!next.done) timer = setTimeout(tick, 3000); else loadHistory();
        }
      } catch (error) { if (!stop) fail(error, 'Could not load this check.'); }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [selected, loadHistory]);

  const setMode2 = (next: 'single' | 'compare') => {
    setMode(next);
    setDrafts((d) => next === 'compare' ? [d[0] || emptyDraft(), d[1] || emptyDraft()] : [d[0] || emptyDraft()]);
  };

  const attach = async (index: number, files: FileList | null) => {
    if (!files?.length) return;
    setNotice(null); setUploading(index);
    try {
      const urls = await uploadFiles(files);
      setDrafts((all) => all.map((d, i) => i === index ? { ...d, mediaUrls: urls.some(isVideo) ? urls.slice(0, 1) : [...d.mediaUrls.filter((u) => !isVideo(u)), ...urls].slice(0, 10) } : d));
    } catch (error) { fail(error, 'Could not upload that file.'); }
    finally { setUploading(null); const input = fileRefs.current[index]; if (input) input.value = ''; }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setNotice(null); setSubmitting(true);
    try {
      if (mode === 'single') {
        const created = await api<Check>('/preflight', { method: 'POST', body: JSON.stringify({ platform, caption, mediaUrls: drafts[0].mediaUrls, text: drafts[0].text }) });
        setSelected({ type: 'check', id: created.id });
      } else {
        const created = await api<{ groupId: string }>('/preflight/compare', { method: 'POST', body: JSON.stringify({ platform, caption, variants: drafts }) });
        setSelected({ type: 'group', id: created.groupId });
      }
      loadHistory();
    } catch (error) { fail(error, 'Could not start the check.'); }
    finally { setSubmitting(false); }
  };

  const retry = async (id: string) => {
    try { await api(`/preflight/${id}/retry`, { method: 'POST' }); setSelected({ type: 'check', id }); } catch (error) { fail(error, 'Could not retry.'); }
  };

  const remove = async (id: string) => {
    try {
      await api(`/preflight/${id}`, { method: 'DELETE' });
      setHistory((h) => h.filter((c) => c.id !== id));
      if (selected?.id === id) { setSelected(null); setCheck(null); }
    } catch (error) { fail(error, 'Could not delete this check.'); }
  };

  const saveHook = async (text: string) => {
    try {
      await api('/hooks', { method: 'POST', body: JSON.stringify({ text, platform, category: 'CURIOSITY' }) });
      setNotice({ kind: 'success', text: 'Saved to your hook library.' });
    } catch (error) { fail(error, 'Could not save this hook.'); }
  };

  const ready = drafts.every((d) => d.mediaUrls.length || d.text.trim()) || (mode === 'single' && caption.trim());

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Before you post</div><h2>Pre-flight check</h2><p>Upload a reel, image or post and see how people will likely react, with fixes you can make before it goes live.</p></div>
      <div className="page-intro-actions">
        <span className={status.audienceSimulation ? 'live-pill' : 'status-pill status-draft'} role="status">{status.audienceSimulation && <i aria-hidden="true" />}{status.audienceSimulation ? 'Audience simulation on' : 'AI review'}</span>
      </div>
    </section>

    {!status.ai && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> AI is not set up yet. Add OPENROUTER_API_KEY to backend/.env and restart the backend.</div>}
    {notice && <div className={`notice ${notice.kind === 'success' ? 'notice-success' : 'notice-error'}`} role="alert" aria-live="polite"><Icon name={notice.kind === 'success' ? 'check' : 'alert'} size={15} /> {notice.text}</div>}

    <div className="split-layout">
      <div className="stack">
        <section className="card form-card" aria-labelledby="check-title">
          <div className="card-header"><div><h3 className="card-title" id="check-title">Check a post</h3><p className="card-subtitle">Reels get a second-by-second read on attention. Images and text get a full review too.</p></div><span className="stat-icon"><Icon name="gauge" size={15} /></span></div>
          <form className="form-grid" onSubmit={submit}>
            <div className="tag-row" role="tablist" aria-label="Check mode">
              <button type="button" role="tab" aria-selected={mode === 'single'} className={`toolbar-filter ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode2('single')}>One post</button>
              <button type="button" role="tab" aria-selected={mode === 'compare'} className={`toolbar-filter ${mode === 'compare' ? 'active' : ''}`} onClick={() => setMode2('compare')}>Compare versions</button>
            </div>
            <div className="field"><label className="field-label" htmlFor="pf-platform">Posting to</label><select id="pf-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>

            {drafts.map((draft, i) => {
              const video = draft.mediaUrls.some(isVideo);
              return <fieldset className="field plain-fieldset pf-draft" key={i}>
                {mode === 'compare' && <legend className="field-label">Version {String.fromCharCode(65 + i)}</legend>}
                <input ref={(el) => { fileRefs.current[i] = el; }} type="file" accept={ACCEPT} multiple className="sr-only" aria-label={`Upload media${mode === 'compare' ? ` for version ${String.fromCharCode(65 + i)}` : ''}`} onChange={(e) => attach(i, e.target.files)} />
                {draft.mediaUrls.length > 0 ? <div className="attach-grid" aria-label="Attached media">
                  {draft.mediaUrls.map((url) => <div className="attach-item" key={url}>
                    {isVideo(url) ? <span className="attach-video"><Icon name="play" size={16} /> Video</span> : <img src={url} alt="Upload preview" loading="lazy" />}
                    <button className="attach-remove" type="button" onClick={() => setDrafts((all) => all.map((d, j) => j === i ? { ...d, mediaUrls: d.mediaUrls.filter((u) => u !== url) } : d))} aria-label="Remove file">×</button>
                  </div>)}
                </div> : <button className="pf-drop" type="button" onClick={() => fileRefs.current[i]?.click()} disabled={uploading !== null}>
                  <Icon name="plus" size={16} /> {uploading === i ? 'Uploading…' : 'Upload a reel, image or carousel'}
                  <small>MP4, MOV, JPG, PNG, WebP or GIF · up to 100 MB</small>
                </button>}
                {draft.mediaUrls.length > 0 && !video && draft.mediaUrls.length < 10 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRefs.current[i]?.click()} disabled={uploading !== null}><Icon name="plus" size={13} /> Add slide</button>}
                <label className="field-label" htmlFor={`pf-text-${i}`}>{draft.mediaUrls.length ? (video ? 'Voiceover or on-screen text (optional)' : 'Text on the image (optional)') : 'Or paste a text post'}</label>
                <textarea id={`pf-text-${i}`} rows={3} maxLength={5000} placeholder={draft.mediaUrls.length ? 'Helps the review follow what is said or shown' : 'What you plan to post on Threads or Facebook'} value={draft.text} onChange={(e) => setDrafts((all) => all.map((d, j) => j === i ? { ...d, text: e.target.value } : d))} />
              </fieldset>;
            })}
            {mode === 'compare' && drafts.length < 3 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDrafts((d) => [...d, emptyDraft()])}><Icon name="plus" size={13} /> Add version C</button>}

            <div className="field"><label className="field-label" htmlFor="pf-caption">Caption {mode === 'compare' && '(shared)'}</label><textarea id="pf-caption" rows={3} maxLength={2200} placeholder="The caption you plan to use" value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
            <div className="form-actions">
              <button className="btn" type="submit" disabled={submitting || uploading !== null || !status.ai || !ready}><Icon name="gauge" size={15} /> {submitting ? 'Starting…' : mode === 'compare' ? 'Compare versions' : 'Run pre-flight check'}</button>
            </div>
          </form>
        </section>

        <section className="card data-card" aria-labelledby="pf-history-title">
          <div className="card-header"><div><h3 className="card-title" id="pf-history-title">Recent checks <span className="list-count">{history.length}</span></h3></div></div>
          <div className="pf-history">
            {history.map((c) => <div className={`pf-history-item ${selected?.id === c.id || selected?.id === c.groupId ? 'active' : ''}`} key={c.id}>
              <button type="button" className="pf-history-open" onClick={() => setSelected(c.groupId ? { type: 'group', id: c.groupId } : { type: 'check', id: c.id })}>
                <strong>{c.verdict || (busy(c) ? 'Checking…' : c.status === 'FAILED' ? 'Check failed' : 'Untitled check')}</strong>
                <span>{c.label ? `${c.label} · ` : ''}{KIND_LABELS[c.kind]} · {new Date(c.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </button>
              <button className="icon-btn" type="button" aria-label="Delete check" onClick={() => remove(c.id)}><Icon name="trash" size={13} /></button>
            </div>)}
            {history.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="gauge" size={18} /></div><strong>No checks yet</strong>Your results will be listed here.</div>}
          </div>
        </section>
      </div>

      <section className="card data-card" aria-labelledby="pf-result-title" aria-live="polite">
        {!check && !group && <div className="empty-state" style={{ marginTop: 22 }}><div className="empty-icon"><Icon name="gauge" size={18} /></div><strong id="pf-result-title">See how people will likely react</strong>Upload a post on the left. You will get a verdict, timestamped fixes and stronger hooks to try.</div>}
        {group && <GroupView group={group} onRetry={retry} onSaveHook={saveHook} />}
        {check && <CheckView check={check} onRetry={retry} onSaveHook={saveHook} />}
      </section>
    </div>
  </div>;
}

function GroupView({ group, onRetry, onSaveHook }: { group: Group; onRetry: (id: string) => void; onSaveHook: (t: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = group.checks.find((c) => c.id === open) || (group.ranking ? group.checks.find((c) => c.id === group.ranking![0]?.id) : null) || group.checks[0];
  return <div>
    <div className="card-header"><div><h3 className="card-title" id="pf-result-title">Version comparison</h3><p className="card-subtitle">{group.done ? (group.rankedBy === 'AUDIENCE_SIMULATION' ? 'Ranked by predicted attention in the first 3 seconds.' : 'Ranked by how strongly each version opens.') : 'Checking each version…'}</p></div></div>
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
    {shown && <CheckView check={shown} onRetry={onRetry} onSaveHook={onSaveHook} nested />}
  </div>;
}

function CheckView({ check, onRetry, onSaveHook, nested }: { check: Check; onRetry: (id: string) => void; onSaveHook: (t: string) => void; nested?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const sim = check.signals?.simulation;
  const seek = (sec: number) => { const v = videoRef.current; if (v) { v.currentTime = sec; v.play().catch(() => { /* autoplay blocked */ }); } };
  const Title = nested ? 'h4' : 'h3';

  if (busy(check)) return <div className="pf-body">
    <Title className="card-title" id={nested ? undefined : 'pf-result-title'}>{check.label ? `${check.label}: checking…` : 'Checking your post…'}</Title>
    <p className="card-subtitle">{check.kind === 'VIDEO' ? 'Reading the frames, cuts and sound. With the audience simulation on, reels can take a few minutes.' : 'This usually takes under a minute.'}</p>
    <div className="skeleton" style={{ height: 160, marginTop: 16 }} />
  </div>;

  if (check.status === 'FAILED' || !check.report) return <div className="pf-body">
    <Title className="card-title" id={nested ? undefined : 'pf-result-title'}>This check failed</Title>
    <p className="card-subtitle">{check.error || 'Something went wrong.'}</p>
    <div className="form-actions" style={{ marginTop: 12 }}><button className="btn btn-sm" type="button" onClick={() => onRetry(check.id)}>Try again</button></div>
  </div>;

  const r = check.report;
  return <div className="pf-body">
    <div className="idea-meta">
      {check.label && <span className="tag">{check.label}</span>}
      <span className="tag">{KIND_LABELS[check.kind]}</span>
      <span className="tag">{PLATFORMS.find((p) => p.id === check.platform)?.label}</span>
      <span className="tag tag-brand">{check.engine === 'AUDIENCE_SIMULATION' ? 'Audience simulation + AI review' : 'AI review'}</span>
      <span className="tag tag-muted">Estimate</span>
    </div>
    <Title className="pf-verdict" id={nested ? undefined : 'pf-result-title'}>{r.verdict}</Title>

    <div className="pf-scores">
      <div className={`pf-score pf-${r.hook.rating.toLowerCase()}`}><span>Hook</span><strong>{RATING_LABELS[r.hook.rating]}</strong><small>{r.hook.reason}</small></div>
      {r.dimensions.filter((d) => d.key !== 'HOOK').map((d) => <div className={`pf-score pf-${d.rating.toLowerCase()}`} key={d.key}><span>{DIMENSION_LABELS[d.key] || d.key}</span><strong>{RATING_LABELS[d.rating]}</strong><small>{d.note}</small></div>)}
    </div>

    {check.kind === 'VIDEO' && check.mediaUrls[0] && <video ref={videoRef} className="pf-video" src={check.mediaUrls[0]} controls playsInline preload="metadata" onTimeUpdate={(e) => setNow((e.target as HTMLVideoElement).currentTime)} />}
    {check.kind !== 'VIDEO' && check.mediaUrls.length > 0 && <div className="pf-images">{check.mediaUrls.map((u, i) => <img key={u} src={u} alt={check.kind === 'CAROUSEL' ? `Slide ${i + 1}` : 'Your image'} loading="lazy" />)}</div>}
    {sim && <AttentionChart sim={sim} now={now} onSeek={seek} />}
    {check.signals?.simulationError && <p className="form-hint">Audience simulation unavailable for this check ({check.signals.simulationError}). Insights come from the AI review.</p>}

    <h4 className="pf-section">What to fix</h4>
    <ul className="pf-insights">
      {r.insights.map((i, n) => <li className={`pf-insight sev-${i.severity.toLowerCase()}`} key={n}>
        <div className="pf-insight-head">
          <strong>{i.title}</strong>
          {span(i) && (check.kind === 'VIDEO' ? <button type="button" className="pf-time" onClick={() => seek(i.startSec!)} aria-label={`Play from ${clock(i.startSec!)}`}><Icon name="play" size={11} /> {span(i)}</button> : <span className="pf-time">{span(i)}</span>)}
          <span className="tag tag-muted">{BASIS_LABELS[i.basis] || i.basis}</span>
        </div>
        <p>{i.detail}</p>
        <p className="pf-fix"><strong>Fix:</strong> {i.fix}</p>
      </li>)}
    </ul>

    {r.alternativeHooks.length > 0 && <>
      <h4 className="pf-section">Stronger openings to try</h4>
      <ul className="pf-hooks">{r.alternativeHooks.map((h) => <li key={h}><span>&ldquo;{h}&rdquo;</span>
        <button className="btn btn-sm btn-soft" type="button" onClick={() => onSaveHook(h)}><Icon name="star" size={13} /> Save</button>
        <button className="icon-btn" type="button" aria-label="Copy hook" onClick={() => navigator.clipboard?.writeText(h)}><Icon name="copy" size={13} /></button>
      </li>)}</ul>
    </>}

    <p className="form-hint pf-disclaimer">These are predictions, not guarantees. {check.engine === 'AUDIENCE_SIMULATION' ? 'The attention curve comes from a research model of how an average viewer processes video; it has not yet been checked against your real results.' : 'They come from an AI review of your post and your past performance.'}</p>
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
