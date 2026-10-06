'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';
import { errorText, platformFor as platform, platformName as platformLabel } from '../../lib/format';
import TrendChart from '../../components/TrendChart';
import Insight from '../../components/studio/Insight';
import PostDrawer from '../../components/studio/PostDrawer';
import Spark from '../../components/studio/Spark';
import Thumb from '../../components/studio/Thumb';
import { compactNumber, formatName } from '../../lib/format';
import { type Post } from '../../lib/posts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Channel = { accountId: string; provider: string; name?: string | null; views: number; engagements: number; engagementRate: number | null; followers: number | null; share: number; syncedAt: string | null; error: string | null };
type PostStat = { id: string; publishedAt: string; views: number | null; engagements: number | null };
type TopPost = { id: string; platform: string; caption: string | null; mediaType: string; mediaUrls?: string; permalink: string | null; publishedAt: string; views: number | null; engagements: number | null };
type Data = {
  range: { days: number; since: string; until: string };
  hasInsights: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  totals: { views: number; viewsChange: number | null; reach: number; engagements: number; engagementRate: number | null; engagementRateChange: number | null; published: number; publishedChange: number | null; followers: number | null };
  series: { date: string; views: number; engagements: number }[];
  channels: Channel[];
  topPosts: TopPost[];
  postStats?: PostStat[];
};

const RANGES = [7, 30, 90];
function num(n: number | null | undefined) { return n == null ? 'n/a' : compactNumber(n); }
function shortDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: '2-digit', timeZone: 'UTC' }); }
function ago(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function Change({ value, unit = '%', empty }: { value: number | null; unit?: string; empty: string }) {
  if (value == null) return <span className="stat-change trend-flat">{empty}</span>;
  return <span className={`stat-change ${value >= 0 ? 'trend-up' : 'trend-warn'}`}>{value >= 0 ? '+' : ''}{value}{unit}</span>;
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [open, setOpen] = useState<Post | null>(null);
  useEffect(() => { api<Post[]>('/posts').then(setPosts).catch(() => setPosts([])); }, []);
  const byId = new Map(posts.map((p) => [p.id, p]));

  const load = useCallback(() => api<Data>(`/analytics?days=${days}`).then((d) => { setData(d); setError(null); return d; }), [days]);

  useEffect(() => {
    setLoading(true);
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  // While a sync runs on the server, refresh until it finishes.
  useEffect(() => {
    if (!data?.syncing) return;
    const t = setTimeout(() => { load().catch(() => undefined); }, 3000);
    return () => clearTimeout(t);
  }, [data, load]);

  const syncNow = async () => {
    try {
      await api('/analytics/sync', { method: 'POST' });
      setData((d) => (d ? { ...d, syncing: true } : d));
    } catch (e) {
      toast.error(errorText(e, 'Could not start a sync.'));
    }
  };

  const exportReport = () => {
    if (!data) return;
    const rows = [['date', 'views', 'engagements'], ...data.series.map((s) => [s.date.slice(0, 10), s.views, s.engagements])];
    // A real file download, which is what "Export CSV" promises.
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `motion-analytics-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const t = data?.totals;
  const channels = data?.channels ?? [];
  const best = channels.find((c) => c.engagements > 0);
  const synced = ago(data?.lastSyncedAt ?? null);
  const noData = !loading && !data?.hasInsights;

  return <div className="an-page">
    <section className="page-intro">
      <div><div className="eyebrow">Performance intelligence</div><h1>Analytics at a glance</h1><p>Understand what is resonating, then make more of it.</p></div>
      <div className="page-intro-actions">
        {data?.syncing
          ? <span className="live-pill" role="status"><i aria-hidden="true" />Syncing with Meta…</span>
          : synced && <span className="sync-meta" role="status">Updated {synced}</span>}
        <button className="btn btn-ghost btn-sm" type="button" onClick={syncNow} disabled={loading || data?.syncing || !channels.length}><Icon name="refresh" size={13} className={data?.syncing ? 'spin' : ''} /> {data?.syncing ? 'Syncing…' : 'Sync now'}</button>
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <TabsList aria-label="Date range">
            {RANGES.map((r) => <TabsTrigger key={r} value={String(r)} aria-label={`Last ${r} days`}>{r}d</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
    </section>
    {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
    <PostDrawer post={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={() => api<Post[]>('/posts').then(setPosts)} />
    {!loading && !noData && t && (
      <section className="ov-brief" aria-label="Summary">
        <Insight action={<Link className="st-chip dark" href="/lab">Plan more ideas</Link>}>
          {t.viewsChange != null ? <><b>Views are {t.viewsChange >= 0 ? 'up' : 'down'} {Math.abs(t.viewsChange)}%</b> on the previous {days} days. </> : <>You earned <b>{num(t.views)} views</b> in the last {days} days. </>}
          {best ? <>Most engagement came from <b>{best.name || platformLabel(platform(best.provider))}</b> ({best.share}%). </> : null}
          {t.publishedChange != null && t.publishedChange < 0 ? <>You published {Math.abs(t.publishedChange)}% fewer posts than before.</> : t.publishedChange != null && t.publishedChange > 0 ? <>You published {t.publishedChange}% more posts than before.</> : null}
        </Insight>
      </section>
    )}
    <div className="ov-bento an">
      <div className="an-kpi st-rise" style={{ ['--i' as string]: 0 }}>
        <div className="ov-tile-top"><span className="ov-eyebrow">Total views</span><Change value={noData ? null : t?.viewsChange ?? null} empty={noData ? 'Sync needed' : 'New'} /></div>
        <div className="ov-stat-num">{loading ? '…' : noData ? 'n/a' : num(t?.views)}</div>
        <div className="an-visual"><Spark values={(data?.series || []).map((x) => x.views)} /></div>
        <p className="ov-stat-note">Daily views, last {days} days</p>
      </div>
      <div className="an-kpi st-rise" style={{ ['--i' as string]: 1 }}>
        <div className="ov-tile-top"><span className="ov-eyebrow">Engagement rate</span><Change value={t?.engagementRateChange ?? null} unit=" pts" empty={noData ? 'Sync needed' : 'New'} /></div>
        <div className="ov-stat-num">{loading ? '…' : t?.engagementRate == null ? 'n/a' : `${t.engagementRate}%`}</div>
        <div className="an-visual"><Spark values={(data?.series || []).map((x) => (x.views ? (x.engagements / x.views) * 100 : 0))} /></div>
        <p className="ov-stat-note">Engagements per view, daily</p>
      </div>
      <div className="an-kpi st-rise" style={{ ['--i' as string]: 2 }}>
        <div className="ov-tile-top"><span className="ov-eyebrow">Published posts</span><Change value={t?.publishedChange ?? null} empty="New" /></div>
        <div className="ov-stat-num">{loading ? '…' : t?.published ?? 0}</div>
        <div className="an-visual"><Spark values={(data?.series || []).map((x) => x.engagements)} /></div>
        <p className="ov-stat-note">{t?.published != null && t.publishedChange != null && t.publishedChange > -100 ? `Previous ${days} days: ${Math.round(t.published / (1 + t.publishedChange / 100))}` : `Last ${days} days`}</p>
      </div>
      <div className="an-kpi st-rise" style={{ ['--i' as string]: 3 }}>
        <div className="ov-tile-top"><span className="ov-eyebrow">Best channel</span>{best && <Icon name={platform(best.provider)} size={15} />}</div>
        <div className="ov-stat-num an-name">{loading ? '…' : best ? best.name || platformLabel(platform(best.provider)) : 'n/a'}</div>
        <div className="an-visual">{best && <div className="mix-bar an-bestbar" role="progressbar" aria-valuenow={best.share} aria-valuemin={0} aria-valuemax={100} aria-label="Share of all engagements"><i style={{ width: `${best.share}%` }} /></div>}</div>
        <p className="ov-stat-note">{best ? `${num(best.engagements)} engagements, ${best.share}% of all` : channels.length ? 'No engagement data yet' : 'No channels connected'}</p>
      </div>

      <section className="an-chart st-rise" style={{ ['--i' as string]: 4 }} aria-labelledby="reach-title">
        <div className="ov-tile-top">
          <div><h2 className="ov-eyebrow" id="reach-title">Views and engagement</h2><p className="ov-stat-note" style={{ marginTop: 4 }}>{noData ? 'Insights appear here after your first sync with Meta.' : `Daily totals across all channels, last ${days} days.`}</p></div>
          <button className="card-action" type="button" onClick={exportReport} disabled={noData || !data?.series.length}>Export CSV <Icon name="arrow-up-right" size={12} /></button>
        </div>
        {!noData && <div className="chart-legend" aria-hidden="true"><span className="legend-item"><i className="legend-dot" /> Views</span><span className="legend-item"><i className="legend-dot light" /> Engagements</span></div>}
        {loading ? <div className="skeleton" style={{ height: 180 }} aria-hidden="true" />
          : noData ? <div className="ov-empty"><strong>No insights yet</strong><p>{channels.length ? 'Run a sync to pull views and engagement from Meta.' : 'Connect a channel to start collecting insights.'}</p></div>
          : <TrendChart series={data!.series} id="analytics" />}
      </section>

      <section className="an-mix st-rise" style={{ ['--i' as string]: 5 }} aria-labelledby="mix-title">
        <div className="ov-tile-top"><h2 className="ov-eyebrow" id="mix-title">Channel mix</h2><span className="list-count">{channels.length}</span></div>
        <div className="an-mix-list">
          {loading && [0, 1].map((i) => <div key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          {!loading && channels.map((c) => (
            <div className="an-mix-row" key={c.accountId}>
              <div className="an-mix-top">
                <span className={`platform-avatar ${platform(c.provider)}`} aria-hidden="true"><Icon name={platform(c.provider)} size={15} /></span>
                <div className="channel-copy"><strong>{c.name || 'Connected account'}</strong><span title={c.error ?? undefined}>{platformLabel(platform(c.provider))} · {c.error ? 'Sync issue, try reconnecting' : !c.syncedAt ? 'Awaiting first sync' : `${num(c.views)} views${c.followers != null ? ` · ${num(c.followers)} followers` : ''}`}</span></div>
                <strong className="an-share">{c.share}%</strong>
              </div>
              <div className="mix-bar" role="progressbar" aria-valuenow={c.share} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name || 'Account'} share of engagements`}><i style={{ width: `${c.share}%` }} /></div>
            </div>
          ))}
          {!loading && !channels.length && <div className="ov-empty"><strong>No channels yet</strong><p>Your performance report appears here.</p><Link className="btn btn-ghost" href="/connect">Connect a channel</Link></div>}
        </div>
      </section>

      <section className="an-rhythm st-rise" style={{ ['--i' as string]: 6 }} aria-labelledby="rhythm-title">
        <div className="ov-tile-top"><h2 className="ov-eyebrow" id="rhythm-title">Posting rhythm</h2></div>
        <Rhythm posts={posts} stats={data?.postStats || []} />
      </section>

      <section className="an-top st-rise" style={{ ['--i' as string]: 7 }} aria-labelledby="top-title">
        <div className="ov-tile-top"><h2 className="ov-eyebrow" id="top-title">Top posts</h2><span className="ov-small muted">Most engaging in the last {days} days</span></div>
        {!loading && data?.topPosts.length ? (
          <ol className="an-top-list">
            {data.topPosts.map((p, i) => {
              const full = byId.get(p.id);
              const pf = platform(p.platform);
              const share = t?.engagements && p.engagements ? Math.round((p.engagements / t.engagements) * 100) : null;
              return (
                <li key={p.id} className="an-top-item">
                  <button type="button" className="an-top-row" onClick={() => full && setOpen(full)} disabled={!full}>
                    <Thumb id={p.id} media={p.mediaUrls ?? full?.mediaUrls} mediaType={p.mediaType} caption={p.caption} className="an-top-thumb" badge={i === 0 ? 'Top' : undefined} />
                    <span className="an-top-copy"><strong>{p.caption || `${formatName(p.mediaType)} post`}</strong><span>{platformLabel(pf)} · {shortDate(p.publishedAt)} · {num(p.views)} views</span></span>
                    <span className="an-top-num"><b>{num(p.engagements)}</b><small>{p.engagements === 1 ? 'engagement' : 'engagements'}{share != null ? `, ${share}% of all` : ''}</small></span>
                  </button>
                  {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="inline-link an-top-link">View post<span className="sr-only"> (opens in a new tab)</span></a>}
                </li>
              );
            })}
          </ol>
        ) : <div className="ov-empty"><p>{loading ? 'Loading…' : 'No post insights for this period yet.'}</p></div>}
      </section>
    </div>
  </div>;
}

const PARTS = ['Morning', 'Midday', 'Afternoon', 'Evening', 'Late'];
const partIndex = (h: number) => (h >= 5 && h < 11 ? 0 : h >= 11 && h < 15 ? 1 : h >= 15 && h < 19 ? 2 : h >= 19 && h < 23 ? 3 : 4);
const DAYS = [1, 2, 3, 4, 5, 6, 0];

/** Published posts by weekday and part of day, shaded by the engagement they earned where it was measured. */
function Rhythm({ posts, stats }: { posts: Post[]; stats: PostStat[] }) {
  const eng = new Map(stats.map((t) => [t.id, t.engagements || 0]));
  const cells = new Map<string, { n: number; e: number }>();
  let total = 0;
  for (const p of posts) {
    if (p.status !== 'PUBLISHED') continue;
    const d = new Date(p.scheduledAt);
    const key = `${d.getDay()}-${partIndex(d.getHours())}`;
    const c = cells.get(key) || { n: 0, e: 0 };
    c.n += 1; c.e += eng.get(p.id) || 0;
    cells.set(key, c); total++;
  }
  if (!total) return <div className="ov-empty"><p>Once you have published posts, this shows when you post and what each slot earned.</p></div>;
  const maxE = Math.max(1, ...[...cells.values()].map((c) => c.e));
  const maxN = Math.max(1, ...[...cells.values()].map((c) => c.n));
  const measured = [...cells.values()].some((c) => c.e > 0);
  return (
    <>
      <div className="an-heat" role="table" aria-label="Published posts by weekday and part of day">
        <span />
        {DAYS.map((d) => <span className="an-heat-h" key={d}>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2024, 0, 7 + d))}</span>)}
        {PARTS.map((label, pi) => (
          <div className="an-heat-row" key={label}>
            <span className="an-heat-l">{label}</span>
            {DAYS.map((d) => {
              const c = cells.get(`${d}-${pi}`);
              const v = c ? (measured ? c.e / maxE : c.n / maxN) : 0;
              return <span key={d} className={`an-heat-c ${c ? 'on' : ''}`} style={{ ['--v' as string]: `${Math.round(14 + v * 78)}%` }} title={c ? `${c.n} post${c.n === 1 ? '' : 's'}${c.e ? `, ${compactNumber(c.e)} engagements` : ''}` : 'No posts'}>{c ? c.n : ''}</span>;
            })}
          </div>
        ))}
      </div>
      <p className="ov-stat-note">{measured ? 'Darker means more engagement. Numbers are posts published in that slot.' : 'Darker means more posts. Engagement shading appears once your posts have insights.'}</p>
    </>
  );
}
