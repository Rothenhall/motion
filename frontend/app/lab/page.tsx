'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import BrandSheet, { type Profile } from '../../components/lab/BrandSheet';
import HooksView from '../../components/lab/HooksView';
import { Icon } from '../../components/Icons';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotOnHint } from '../../components/FeatureGate';
import { api } from '../../lib/api';
import { useCan } from '../../lib/session';
import { errorText, formatName } from '../../lib/format';
import { plain } from '../../lib/text';

type Idea = { id: string; title: string; hook: string; angle?: string | null; format: string; platform: string; pillar?: string | null; caption?: string | null; hashtags: string[]; status: string; source: string; topic?: string | null; createdAt: string };
type Lane = 'NEW' | 'SAVED' | 'USED';

const PLATFORMS = [{ id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'threads', label: 'Threads' }];
const LANES: { id: Lane; label: string; hint: string; empty: string }[] = [
  { id: 'NEW', label: 'Fresh', hint: 'Just written', empty: 'Generate a batch, or turn on autopilot to wake up to new ideas.' },
  { id: 'SAVED', label: 'Saved', hint: 'Worth making', empty: 'Drag a keeper here, or press Save on an idea.' },
  { id: 'USED', label: 'Used', hint: 'Turned into a post', empty: 'Ideas you send to the composer land here.' },
];
const platformLabel = (id: string) => PLATFORMS.find((p) => p.id === id)?.label || id;
const postText = (idea: Idea) => [plain(idea.caption || idea.hook), idea.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');

function LabInner() {
  const router = useRouter();
  const params = useSearchParams();
  const canAi = useCan('ai');
  const canCompose = useCan('compose');
  const view = params.get('view') === 'hooks' ? 'hooks' : 'board';
  const setView = (v: string) => router.replace(v === 'hooks' ? '/lab?view=hooks' : '/lab');

  const [lanes, setLanes] = useState<Record<Lane, Idea[]>>({ NEW: [], SAVED: [], USED: [] });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiReady, setAiReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [request, setRequest] = useState({ topic: '', platform: '', count: 5 });
  const [brandOpen, setBrandOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Lane | null>(null);

  const fail = (error: unknown, fallback: string) => toast.error(errorText(error, fallback));
  const loadAll = useCallback(async () => {
    const [n, s, u] = await Promise.all((['NEW', 'SAVED', 'USED'] as Lane[]).map((st) => api<Idea[]>(`/ideas?status=${st}`)));
    setLanes({ NEW: n || [], SAVED: s || [], USED: u || [] });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [status, prof] = await Promise.all([api<{ configured: boolean }>('/ai/status'), api<Profile | null>('/brand-profile'), loadAll()]);
        setAiReady(status.configured);
        setProfile(prof);
      } catch (error) { setLoadError(errorText(error, 'Could not load your ideas.')); }
      finally { setLoading(false); }
    })();
  }, [loadAll]);

  const all = useMemo(() => [...lanes.NEW, ...lanes.SAVED, ...lanes.USED], [lanes]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile) { setBrandOpen(true); return; }
    setGenerating(true);
    try {
      const created = await api<Idea[]>('/ideas/generate', { method: 'POST', body: JSON.stringify({ ...request, platform: request.platform || undefined }) });
      await loadAll();
      toast.success(`${created.length} new idea${created.length === 1 ? '' : 's'} added`);
      setRequest((r) => ({ ...r, topic: '' }));
    } catch (error) { fail(error, 'Could not generate ideas.'); }
    finally { setGenerating(false); }
  };

  const move = async (idea: Idea, to: Lane | 'DISMISSED') => {
    if (idea.status === to) return;
    const from = idea.status as Lane;
    const before = lanes;
    setLanes((cur) => {
      const next = { ...cur, [from]: cur[from].filter((i) => i.id !== idea.id) } as Record<Lane, Idea[]>;
      if (to !== 'DISMISSED') next[to] = [{ ...idea, status: to }, ...cur[to]];
      return next;
    });
    try {
      await api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: to }) });
      if (to === 'DISMISSED') {
        toast('Idea dismissed', { description: idea.title, action: { label: 'Undo', onClick: async () => { try { await api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: from }) }); await loadAll(); } catch (e) { fail(e, 'Could not undo that.'); } } } });
      }
    } catch (error) { setLanes(before); fail(error, 'Could not update this idea.'); }
  };

  const startPostFrom = async (idea: Idea) => {
    try { await api(`/ideas/${idea.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'USED' }) }); } catch { /* still open the composer */ }
    window.location.assign(`/?compose=true&idea=${encodeURIComponent(idea.id)}&caption=${encodeURIComponent(postText(idea))}`);
  };

  const dropOn = (lane: Lane) => {
    const idea = all.find((i) => i.id === dragId);
    setDragId(null); setOver(null);
    if (idea) move(idea, lane);
  };

  const autopilotOn = !!profile?.autopilot;

  return (
    <div className="lab">
      <section className="page-intro">
        <div><div className="eyebrow">Content engine</div><h1>Content Lab</h1><p>Ideas and hooks in one place. Write a batch, keep the best, and send one to the composer.</p></div>
        <div className="page-intro-actions">
          <span className={autopilotOn ? 'live-pill' : 'status-pill status-draft'}>{autopilotOn && <i aria-hidden="true" />}Autopilot {autopilotOn ? 'on' : 'off'}</span>
          <button className="btn btn-ghost" type="button" onClick={() => setBrandOpen(true)}><Icon name="settings" size={15} /> Brand voice</button>
        </div>
      </section>

      {!aiReady && <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> AI is not set up yet. Add OPENROUTER_API_KEY to backend/.env and restart the backend.</div>}
      {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}</div>}
      <BrandSheet open={brandOpen} onOpenChange={setBrandOpen} profile={profile} onSaved={setProfile} />

      <div className="lab-bar">
        <Tabs value={view} onValueChange={setView}>
          <TabsList aria-label="Content Lab view">
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="hooks">Hook library</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === 'board' ? (
        <>
          <form className="lab-prompt" onSubmit={generate} aria-label="Generate ideas">
            <span className="st-ai" aria-hidden="true">AI</span>
            <input aria-label="Topic or campaign" placeholder={profile ? 'Ideas about… (leave empty for a mix across your pillars)' : 'Set up your brand voice first, then ask for ideas'} value={request.topic} onChange={(e) => setRequest({ ...request, topic: e.target.value })} maxLength={300} />
            <Select aria-label="Platform" className="lab-sel" value={request.platform} onChange={(e) => setRequest({ ...request, platform: e.target.value })}><option value="">All platforms</option>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
            <Select aria-label="How many ideas" className="lab-sel" value={request.count} onChange={(e) => setRequest({ ...request, count: Number(e.target.value) })}>{[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n} ideas</option>)}</Select>
            <button className="btn" type="submit" disabled={generating || !canAi || (!!profile && !aiReady)} aria-describedby={canAi ? undefined : 'ai-off'}>
              <Icon name="sparkles" size={15} className={generating ? 'spin' : ''} /> {generating ? 'Thinking…' : profile ? 'Generate' : 'Set up voice'}
            </button>
            {!canAi && <NotOnHint id="ai-off" />}
          </form>

          <div className="lab-board">
            {LANES.map((lane) => (
              <section
                key={lane.id}
                className={`lab-lane ${over === lane.id ? 'over' : ''}`}
                aria-labelledby={`lane-${lane.id}`}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(lane.id); } }}
                onDragLeave={() => setOver((o) => (o === lane.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); dropOn(lane.id); }}
              >
                <header className="lab-lane-h"><h2 id={`lane-${lane.id}`}>{lane.label}</h2><span className="list-count">{lanes[lane.id].length}</span><small>{lane.hint}</small></header>
                <div className="lab-cards">
                  {loading && [0, 1].map((i) => <div key={i} className="skeleton" style={{ height: 150 }} aria-hidden="true" />)}
                  {!loading && lanes[lane.id].map((idea) => (
                    <article
                      key={idea.id}
                      className={`lab-card ${dragId === idea.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', idea.id); setDragId(idea.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                    >
                      <div className="lab-tags">
                        <span className="st-chip"><Icon name={idea.platform === 'facebook' ? 'facebook' : idea.platform === 'threads' ? 'threads' : 'instagram'} size={11} /> {platformLabel(idea.platform)}</span>
                        <span className="st-chip">{formatName(idea.format)}</span>
                        {idea.pillar && <span className="st-chip">{idea.pillar}</span>}
                        {idea.source === 'AUTOPILOT' && <span className="st-chip dark">Autopilot</span>}
                      </div>
                      <h3>{plain(idea.title)}</h3>
                      <p className="lab-hook">&ldquo;{plain(idea.hook)}&rdquo;</p>
                      {idea.angle && <p className="lab-angle">{plain(idea.angle)}</p>}
                      {idea.caption && <details className="idea-caption"><summary>Caption draft</summary><p>{plain(idea.caption)}</p>{idea.hashtags.length > 0 && <p className="idea-tags">{idea.hashtags.map((h) => `#${h}`).join(' ')}</p>}</details>}
                      <div className="lab-actions">
                        {canCompose && <button className="btn btn-sm" type="button" onClick={() => startPostFrom(idea)}><Icon name="send" size={13} /> Use in post</button>}
                        {idea.status === 'NEW' && <button className="btn btn-sm btn-soft" type="button" onClick={() => move(idea, 'SAVED')}><Icon name="star" size={13} /> Save</button>}
                        <button className="icon-btn icon-btn-danger" type="button" onClick={() => move(idea, 'DISMISSED')} aria-label={`Dismiss ${idea.title}`}><Icon name="x" size={13} /></button>
                      </div>
                    </article>
                  ))}
                  {!loading && lanes[lane.id].length === 0 && <div className="lab-empty">{lane.empty}</div>}
                </div>
              </section>
            ))}
          </div>
          {!loading && !profile && (
            <div className="notice notice-warning" role="status"><Icon name="alert" size={15} /> Tell Motion what you post about so ideas sound like you. <button className="card-action" type="button" onClick={() => setBrandOpen(true)}>Set up brand voice</button></div>
          )}
        </>
      ) : (
        <HooksView />
      )}
    </div>
  );
}

export default function Lab() {
  return <Suspense fallback={null}><LabInner /></Suspense>;
}
