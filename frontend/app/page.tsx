'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import './dashboard.css';
import { Icon } from '../components/Icons';
import Composer from '../components/Composer';
import AreaChart from '../components/studio/AreaChart';
import type { TrendPoint } from '../components/TrendChart';
import Insight from '../components/studio/Insight';
import PhonePreview from '../components/studio/PhonePreview';
import PostDrawer from '../components/studio/PostDrawer';
import Spark from '../components/studio/Spark';
import Thumb from '../components/studio/Thumb';
import { api } from '../lib/api';
import { parseMedia } from '../lib/media';
import { canManageChannels } from '../lib/nav';
import { featureOn, useMe, type FeatureKey } from '../lib/session';
import { tolerate } from '../lib/widgets';
import { compactNumber, errorText, formatName, platformFor, platformName } from '../lib/format';
import { addDays, dayKey, fmtDay, fmtTime, needsMedia, postPlatform, startOfDay, startOfWeek, type Draft, type Post } from '../lib/posts';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type DashboardData = { stats: { scheduled: number; published: number; failed: number }; upcomingPosts: Post[]; accounts: Account[]; automationCount: number; activeAutomationCount: number };
type TopPost = { id: string; platform: string; caption?: string | null; mediaType: string; mediaUrls?: string; views: number | null; engagements: number | null };
type Analytics = {
  hasInsights: boolean;
  series: TrendPoint[];
  totals: { views: number; viewsChange: number | null; engagementRate: number | null; engagementRateChange: number | null; engagements: number };
  topPosts: TopPost[];
};

const emptyDashboard: DashboardData = { stats: { scheduled: 0, published: 0, failed: 0 }, upcomingPosts: [], accounts: [], automationCount: 0, activeAutomationCount: 0 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Home() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [posts, setPosts] = useState<Post[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [handoff, setHandoff] = useState<{ caption?: string; day?: string | null; idea?: string }>({});
  const [open, setOpen] = useState<Post | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  // Each widget needs its section switched on. A switch that is off hides the widget; and if the server still says
  // FEATURE_DISABLED for one request (the switch changed while the page was open), only that widget goes away.
  const me = useMe();
  const [blocked, setBlocked] = useState<string[]>([]);
  const block = useCallback((feature: string | undefined, fallback: FeatureKey) => {
    const key = feature || fallback;
    setBlocked((cur) => (cur.includes(key) ? cur : [...cur, key]));
  }, []);
  const has = (key: FeatureKey) => featureOn(me, key) && !blocked.includes(key);
  const plannerOn = has('planner');
  const analyticsOn = has('analytics');
  const composeOn = has('compose');
  const automationsOn = has('automations');
  const canConnect = canManageChannels(me);

  const loadDrafts = useCallback(() => {
    if (!composeOn) { setDrafts([]); return; }
    tolerate(api<Draft[]>('/drafts'), [] as Draft[], (f) => block(f, 'compose')).then((d) => setDrafts(d || [])).catch(() => setDrafts([]));
  }, [composeOn, block]);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [dash, list] = await Promise.all([
        api<DashboardData>('/dashboard'),
        plannerOn ? tolerate(api<Post[]>('/posts'), [] as Post[], (f) => block(f, 'planner')) : Promise.resolve([] as Post[]),
      ]);
      setData(dash); setPosts(list);
    } catch (error) {
      setLoadError(errorText(error, 'Could not load your workspace.'));
    } finally { setLoading(false); }
    if (analyticsOn) tolerate(api<Analytics>('/analytics?days=30'), null, (f) => block(f, 'analytics')).then(setAnalytics).catch(() => setAnalytics(null));
    else setAnalytics(null);
    loadDrafts();
  }, [loadDrafts, plannerOn, analyticsOn, block]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    // Ideas, hooks and the planner open the composer through ?compose=true&caption=…&date=…
    const params = new URLSearchParams(window.location.search);
    if (params.get('compose') === 'true') {
      if (composeOn) {
        setHandoff({ caption: params.get('caption') || undefined, day: params.get('date'), idea: params.get('idea') || undefined });
        setComposerOpen(true);
      }
      window.history.replaceState(null, '', '/');
    }
  }, [composeOn]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()), []);
  const openComposer = (day?: string) => { setHandoff(day ? { day } : {}); setActiveDraft(null); setComposerOpen(true); };
  const openDraft = (d: Draft) => { setHandoff({}); setActiveDraft(d); setComposerOpen(true); };
  const removeDraft = async (d: Draft) => {
    try { await api(`/drafts/${d.id}`, { method: 'DELETE' }); setDrafts((cur) => cur.filter((x) => x.id !== d.id)); toast('Draft deleted'); }
    catch (e) { toast.error(errorText(e, 'Could not delete this draft.')); }
  };

  const now = Date.now();
  const queue = useMemo(() => posts.filter((p) => p.status === 'SCHEDULED' && +new Date(p.scheduledAt) >= now - 60_000).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)), [posts, now]);
  const next = queue[0];
  const todayKey = dayKey(new Date());
  const today = queue.filter((p) => dayKey(new Date(p.scheduledAt)) === todayKey);
  const failed = posts.filter((p) => p.status === 'FAILED');
  const missingMedia = queue.filter(needsMedia);
  const hasInsights = !!analytics?.hasInsights && analytics.series.length > 1;
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);

  // The brief is built from the queue and insights only, so every claim in it can be checked on screen.
  const brief = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let action: React.ReactNode = null;
    if (failed.length) {
      parts.push(<b key="f">{plural(failed.length, 'post')} failed to publish.</b>);
      action = <Link className="st-chip dark" href="/planner">Review</Link>;
    }
    if (today.length) parts.push(<span key="t"><b>{plural(today.length, 'post')} {today.length === 1 ? 'goes' : 'go'} out today</b>, the next at {fmtTime(today[0].scheduledAt)}.</span>);
    else if (next) parts.push(<span key="n">Nothing goes out today. Next up is <b>{fmtDay(next.scheduledAt)}</b> at {fmtTime(next.scheduledAt)}.</span>);
    else parts.push(<span key="e">Your queue is empty, so nothing is scheduled to publish.</span>);
    if (missingMedia.length) {
      parts.push(<span key="m">{plural(missingMedia.length, 'scheduled post')} {missingMedia.length === 1 ? 'has' : 'have'} no media attached.</span>);
      if (!action) action = <button className="st-chip dark" type="button" onClick={() => setOpen(missingMedia[0])}>Fix now</button>;
    }
    const coverage = new Set(queue.map((p) => dayKey(new Date(p.scheduledAt))));
    const gap = [1, 2, 3].filter((n) => !coverage.has(dayKey(addDays(new Date(), n))));
    if (queue.length && gap.length === 3) parts.push(<span key="g">The next three days are empty.</span>);
    if (analytics?.hasInsights && analytics.totals.viewsChange != null && Math.abs(analytics.totals.viewsChange) >= 5) {
      const up = analytics.totals.viewsChange > 0;
      parts.push(<span key="v">Views are <b>{up ? 'up' : 'down'} {Math.abs(analytics.totals.viewsChange)}%</b> on the previous 30 days.</span>);
    }
    if (!action && !queue.length && composeOn) action = <button className="st-chip dark" type="button" onClick={() => openComposer()}>Create a post</button>;
    return { parts, action };
  }, [failed, today, next, missingMedia, queue, analytics, composeOn]);

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(new Date()), i)), []);
  const weekPosts = (d: Date) => posts.filter((p) => dayKey(new Date(p.scheduledAt)) === dayKey(d));
  const rateSeries = analytics?.series.map((s) => (s.views ? (s.engagements / s.views) * 100 : 0)) || [];
  const covered = week.filter((d) => d >= startOfDay(new Date()) && weekPosts(d).length).length;
  const daysLeft = week.filter((d) => d >= startOfDay(new Date())).length;
  const worked = (analytics?.topPosts || []).slice(0, 5);
  const topEng = Math.max(1, ...worked.map((t) => t.engagements || 0));

  return (
    <div className="ov">
      <section className="page-intro dashboard-intro st-rise" style={{ ['--i' as string]: 0 }}>
        <div>
          <div className="eyebrow">{todayLabel}</div>
          <h1>{greeting}</h1>
          <p>Here&apos;s what&apos;s moving across your social channels.</p>
        </div>
        {composeOn && (
          <div className="page-intro-actions">
            <button className="btn" type="button" onClick={() => openComposer()} aria-haspopup="dialog">
              <Icon name="plus" size={16} /> Create post
            </button>
          </div>
        )}
      </section>

      {loadError && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" size={15} /> {loadError}
          <button className="card-action" type="button" onClick={() => { setLoading(true); load(); }} style={{ marginLeft: 'auto' }}>Try again</button>
        </div>
      )}

      {composeOn && <Composer open={composerOpen} onOpenChange={(o) => { setComposerOpen(o); if (!o) setActiveDraft(null); }} draft={activeDraft} onDraftChange={loadDrafts} accounts={data.accounts} accountsLoading={loading} initialCaption={handoff.caption} initialDay={handoff.day} initialIdeaId={handoff.idea} onScheduled={load} />}
      <PostDrawer post={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} />

      {plannerOn && (
        <section className="ov-brief st-rise" style={{ ['--i' as string]: 1 }} aria-label="Today's brief">
          {loading ? <div className="skeleton" style={{ height: 22 }} aria-hidden="true" /> : <Insight action={brief.action}>{brief.parts.map((p, i) => <span key={i}>{p} </span>)}</Insight>}
        </section>
      )}

      <div className="ov-bento">
        {analyticsOn && <section className={`ov-hero st-rise ${plannerOn ? '' : 'ov-span-all'}`} style={{ ['--i' as string]: 2 }} aria-labelledby="hero-t">
          <div className="ov-hero-top">
            <h2 id="hero-t" className="ov-eyebrow">Views · last 30 days</h2>
            <Link className="ov-hero-link" href="/analytics">Analytics <Icon name="arrow-right" size={12} /></Link>
          </div>
          {loading ? <div className="skeleton ov-skel-dark" style={{ height: 170 }} aria-hidden="true" /> : hasInsights ? (
            <>
              <div className="ov-hero-num">
                <strong>{compactNumber(analytics!.totals.views)}</strong>
                {analytics!.totals.viewsChange != null && <span className={`ov-delta ${analytics!.totals.viewsChange >= 0 ? 'up' : 'down'}`}>{analytics!.totals.viewsChange >= 0 ? '+' : ''}{analytics!.totals.viewsChange}%</span>}
              </div>
              <p className="ov-hero-sub">{compactNumber(analytics!.totals.engagements)} engagements · dashed line shows engagements</p>
              <AreaChart series={analytics!.series} id="ov" />
            </>
          ) : (
            <div className="ov-hero-empty">
              <strong>Your trend appears here</strong>
              <p>{data.accounts.length ? 'Sync your channels from Analytics to pull views and engagement from Meta.' : canConnect ? 'Connect a channel and Motion starts collecting views and engagement.' : 'Your account manager will connect your channels. Views and engagement appear here after that.'}</p>
              {(data.accounts.length > 0 || canConnect) && <Link className="btn btn-ghost" href={data.accounts.length ? '/analytics' : '/connect'}>{data.accounts.length ? 'Go to analytics' : 'Connect a channel'}</Link>}
            </div>
          )}
        </section>}

        {plannerOn && <section className={`ov-next st-rise ${analyticsOn ? '' : 'ov-span-all'}`} style={{ ['--i' as string]: 3 }} aria-labelledby="next-t">
          <div className="ov-tile-top"><h2 id="next-t" className="ov-eyebrow">Up next</h2>{next && <span className="st-chip">{fmtDay(next.scheduledAt)}</span>}</div>
          {loading ? <div className="skeleton" style={{ height: 220 }} aria-hidden="true" /> : next ? (
            <button type="button" className="ov-next-btn" onClick={() => setOpen(next)} aria-label={`Open details for the post scheduled ${fmtDay(next.scheduledAt)}`}>
              <PhonePreview platform={postPlatform(next)} name={next.account?.name || platformName(postPlatform(next))} caption={next.caption} media={next.mediaUrls} mediaType={next.mediaType} id={next.id} ratio="1 / 1" />
              <span className="ov-next-meta"><b>{fmtTime(next.scheduledAt)}</b> · {platformName(postPlatform(next))} · {formatName(next.mediaType)}</span>
            </button>
          ) : (
            <div className="ov-empty">
              <strong>Your queue is clear</strong>
              <p>Schedule your next idea to keep momentum going.</p>
              {composeOn && <button className="btn" type="button" onClick={() => openComposer()}>Schedule a post</button>}
            </div>
          )}
        </section>}

        {analyticsOn && <Link className={`ov-stat st-rise ${plannerOn ? '' : 'ov-span-all'}`} style={{ ['--i' as string]: 4 }} href="/analytics" aria-label="Engagement rate, open analytics">
          <div className="ov-tile-top"><span className="ov-eyebrow">Engagement rate</span>{analytics?.totals.engagementRateChange != null && <span className={`st-chip ${analytics.totals.engagementRateChange >= 0 ? 'good' : 'warn'}`}>{analytics.totals.engagementRateChange >= 0 ? '+' : ''}{analytics.totals.engagementRateChange} pts</span>}</div>
          <div className="ov-stat-num">{loading ? '…' : hasInsights && analytics!.totals.engagementRate != null ? `${analytics!.totals.engagementRate}%` : 'n/a'}</div>
          <Spark values={rateSeries} />
          <p className="ov-stat-note">{hasInsights ? 'Engagements per view, last 30 days.' : 'Sync insights to see this.'}</p>
        </Link>}

        {plannerOn && <Link className={`ov-stat st-rise ${analyticsOn ? '' : 'ov-span-all'}`} style={{ ['--i' as string]: 5 }} href="/planner" aria-label="Queue health, open planner">
          <div className="ov-tile-top"><span className="ov-eyebrow">Queue</span>{failed.length > 0 ? <span className="st-chip bad">{failed.length} failed</span> : missingMedia.length > 0 ? <span className="st-chip warn">{missingMedia.length} need media</span> : <span className="st-chip good">healthy</span>}</div>
          <div className="ov-stat-num">{loading ? '…' : queue.length}<small>scheduled</small></div>
          <div className="ov-cover" aria-hidden="true">{week.map((d) => <i key={dayKey(d)} className={weekPosts(d).length ? 'on' : d < startOfDay(new Date()) ? 'past' : ''} />)}</div>
          <p className="ov-stat-note">{daysLeft ? `${covered} of ${daysLeft} days left this week have a post.` : 'Week complete.'} {data.stats.published} published this month.</p>
        </Link>}

        {plannerOn && <section className="ov-week st-rise" style={{ ['--i' as string]: 6 }} aria-labelledby="week-t">
          <div className="ov-tile-top"><h2 id="week-t" className="ov-eyebrow">This week</h2><Link className="card-action" href="/planner">Open planner <Icon name="arrow-right" size={13} /></Link></div>
          <div className="ov-days">
            {week.map((d) => {
              const k = dayKey(d); const items = weekPosts(d); const isToday = k === todayKey; const past = d < startOfDay(new Date());
              return (
                <div className={`ov-day ${isToday ? 'today' : ''} ${past ? 'past' : ''}`} key={k}>
                  <div className="ov-day-h"><span>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)}</span><b>{d.getDate()}</b></div>
                  {items.slice(0, 2).map((p) => (
                    <button type="button" className="ov-mini" key={p.id} onClick={() => setOpen(p)} aria-label={`${p.caption || formatName(p.mediaType)}, ${fmtTime(p.scheduledAt)}`}>
                      <Thumb id={p.id} media={p.mediaUrls} mediaType={p.mediaType} caption={p.caption} ratio="16 / 10" badge={p.status === 'FAILED' ? 'Failed' : needsMedia(p) ? 'No media' : undefined} />
                      <span>{fmtTime(p.scheduledAt)}</span>
                    </button>
                  ))}
                  {items.length > 2 && <span className="more-events">+{items.length - 2} more</span>}
                  {!items.length && !past && composeOn && <button type="button" className="ov-add" onClick={() => openComposer(k)} aria-label={`Schedule a post on ${fmtDay(d)}`}><Icon name="plus" size={13} /></button>}
                </div>
              );
            })}
          </div>
        </section>}

        {analyticsOn && <section className="ov-worked st-rise" style={{ ['--i' as string]: 7 }} aria-labelledby="worked-t">
          <div className="ov-tile-top"><h2 id="worked-t" className="ov-eyebrow">What worked lately</h2><span className="muted ov-small">Top posts by engagement, last 30 days</span></div>
          {worked.length ? (
            <ol className="ov-rank">
              {worked.map((t, i) => {
                const full = byId.get(t.id);
                const hasMedia = parseMedia(t.mediaUrls ?? full?.mediaUrls).length > 0;
                const pct = Math.max(4, Math.round(((t.engagements || 0) / topEng) * 100));
                return (
                  <li key={t.id}>
                    <button type="button" className="ov-rrow" onClick={() => full && setOpen(full)} disabled={!full}>
                      <span className="ov-rnum">{i + 1}</span>
                      {hasMedia && <Thumb id={t.id} media={t.mediaUrls ?? full?.mediaUrls} mediaType={t.mediaType} ratio="1 / 1" className="ov-rthumb" />}
                      <span className="ov-rbody">
                        <span className="ov-rcap">{t.caption || `${formatName(t.mediaType)} post`}</span>
                        <span className="ov-rbar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                      </span>
                      <span className="ov-rnums">
                        <b>{t.views != null ? compactNumber(t.views) : 'n/a'}</b><small>views</small>
                        <b>{t.engagements != null ? compactNumber(t.engagements) : 'n/a'}</b><small>eng.</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="ov-empty row">
              <p>{loading ? 'Loading…' : 'Your best posts show up here once a published post has insights.'}</p>
              {!loading && <Link className="btn btn-ghost" href="/analytics">Sync insights</Link>}
            </div>
          )}
        </section>}

        {composeOn && drafts.length > 0 && (
          <section className="ov-drafts st-rise" style={{ ['--i' as string]: 8 }} aria-labelledby="drafts-t">
            <div className="ov-tile-top"><h2 id="drafts-t" className="ov-eyebrow">Drafts</h2><span className="list-count">{drafts.length}</span></div>
            <ul className="ov-draft-list">
              {drafts.slice(0, 4).map((d) => (
                <li key={d.id} className="ov-draft">
                  <Thumb id={d.id} media={d.mediaUrls} mediaType={d.mediaType} caption={d.caption} className="ov-draft-thumb" />
                  <button type="button" className="ov-draft-copy" onClick={() => openDraft(d)}>
                    <strong>{d.caption ? d.caption.slice(0, 90) : `${formatName(d.mediaType)} draft`}</strong>
                    <span>Edited {new Date(d.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{d.scheduledAt ? ` · planned for ${fmtDay(d.scheduledAt)}` : ''}</span>
                  </button>
                  <button className="btn btn-sm btn-soft" type="button" onClick={() => openDraft(d)}>Continue</button>
                  <button className="icon-btn icon-btn-danger" type="button" onClick={() => removeDraft(d)} aria-label="Delete draft"><Icon name="trash" size={14} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {automationsOn && <Link className="ov-slim st-rise" style={{ ['--i' as string]: 8 }} href="/automations">
          <span className="ov-eyebrow">Automations</span>
          <strong>{data.activeAutomationCount}<small> of {data.automationCount} live</small></strong>
          <span className="ov-small muted">{data.automationCount === 0 ? 'Reply to keyword comments with a DM.' : data.activeAutomationCount === data.automationCount ? 'Every rule is watching comments.' : `${data.automationCount - data.activeAutomationCount} paused.`}</span>
        </Link>}
        <Link className={`ov-slim st-rise ${automationsOn ? '' : 'ov-span-all'}`} style={{ ['--i' as string]: 9 }} href="/connect">
          <span className="ov-eyebrow">Channels</span>
          <strong>{data.accounts.length}<small> connected</small></strong>
          <span className="ov-chans">{data.accounts.slice(0, 4).map((a) => <span className="st-chip" key={a.id}><Icon name={platformFor(a.provider)} size={12} />{a.name || a.externalId}</span>)}{!data.accounts.length && <span className="ov-small muted">{canConnect ? 'Connect your first account.' : 'Your account manager connects your channels.'}</span>}</span>
        </Link>
      </div>
    </div>
  );
}
