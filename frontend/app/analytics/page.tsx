'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Channel = { accountId: string; provider: string; name?: string | null; views: number; engagements: number; engagementRate: number | null; followers: number | null; share: number; syncedAt: string | null; error: string | null };
type TopPost = { id: string; platform: string; caption: string | null; mediaType: string; permalink: string | null; publishedAt: string; views: number | null; engagements: number | null };
type Data = {
  range: { days: number; since: string; until: string };
  hasInsights: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  totals: { views: number; viewsChange: number | null; reach: number; engagements: number; engagementRate: number | null; engagementRateChange: number | null; published: number; publishedChange: number | null; followers: number | null };
  series: { date: string; views: number; engagements: number }[];
  channels: Channel[];
  topPosts: TopPost[];
};

const RANGES = [7, 30, 90];
function platform(provider: string) { return provider === 'facebook_page' || provider === 'facebook' ? 'facebook' : provider === 'threads' ? 'threads' : 'instagram'; }
function platformLabel(p: string) { return p === 'facebook' ? 'Facebook' : p === 'threads' ? 'Threads' : 'Instagram'; }
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
function num(n: number | null | undefined) { return n == null ? '—' : compact.format(n); }
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

/** Two series on one chart, each scaled to its own max so engagement stays readable next to views. */
function TrendChart({ series }: { series: Data['series'] }) {
  const W = 760, TOP = 20, BOTTOM = 170;
  const maxViews = Math.max(1, ...series.map((s) => s.views));
  const maxEng = Math.max(1, ...series.map((s) => s.engagements));
  const x = (i: number) => (series.length > 1 ? (i / (series.length - 1)) * W : W / 2);
  const y = (v: number, max: number) => BOTTOM - (v / max) * (BOTTOM - TOP);
  const line = (key: 'views' | 'engagements', max: number) => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[key], max).toFixed(1)}`).join(' ');
  const views = line('views', maxViews);
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  return (
    <svg viewBox="0 0 760 210" role="img" aria-label={`Daily views (peak ${num(maxViews)}) and engagements (peak ${num(maxEng)})`}>
      <defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity=".18" /><stop offset="100%" stopColor="#4f46e5" stopOpacity="0" /></linearGradient></defs>
      {[20, 70, 120, 170].map((gy) => <line key={gy} className="chart-grid-line" x1="0" y1={gy} x2="760" y2={gy} />)}
      {series.length > 1 && <path d={`${views} V190 H0Z`} fill="url(#analyticsFill)" />}
      <path className="chart-line" d={views} />
      <path d={line('engagements', maxEng)} fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {series.map((s, i) => {
        const last = i === series.length - 1;
        if (i % labelEvery !== 0 && !last) return null;
        if (!last && series.length - 1 - i < labelEvery / 2) return null;
        return <text key={s.date} className="chart-label" x={x(i)} y="205" textAnchor={i === 0 ? 'start' : last ? 'end' : 'middle'}>{shortDate(s.date)}</text>;
      })}
    </svg>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

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
    } catch (e: any) {
      setError(e.message);
    }
  };

  const exportReport = async () => {
    if (!data) return;
    const rows = [['date', 'views', 'engagements'], ...data.series.map((s) => [s.date.slice(0, 10), s.views, s.engagements])];
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.join(',')).join('\n'));
      setExported(true);
      setTimeout(() => setExported(false), 2400);
    } catch { /* clipboard blocked */ }
  };

  const t = data?.totals;
  const channels = data?.channels ?? [];
  const best = channels.find((c) => c.engagements > 0);
  const synced = ago(data?.lastSyncedAt ?? null);
  const noData = !loading && !data?.hasInsights;

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Performance intelligence</div><h2>Analytics at a glance</h2><p>Understand what is resonating, then make more of it.</p></div>
      <div className="page-intro-actions">
        {data?.syncing
          ? <span className="live-pill" role="status"><i aria-hidden="true" />Syncing with Meta…</span>
          : synced && <span className="live-pill" role="status"><i aria-hidden="true" />Updated {synced}</span>}
        <button className="btn btn-ghost btn-sm" type="button" onClick={syncNow} disabled={loading || data?.syncing || !channels.length}>Sync now</button>
        <label className="date-chip"><Icon name="chart" size={15} />
          <select aria-label="Date range" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ height: 'auto', padding: 0, border: 0, background: 'transparent', boxShadow: 'none', color: 'inherit', fontWeight: 600 }}>
            {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
          </select>
        </label>
      </div>
    </section>
    {error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
    <section className="stats-grid" aria-label="Analytics summary">
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Total views</span><span className="stat-icon"><Icon name="chart" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : noData ? '—' : num(t?.views)}</div><div className="stat-foot"><Change value={noData ? null : t?.viewsChange ?? null} empty={noData ? 'Sync needed' : 'New'} /><span className="stat-hint">vs. prior {days} days</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Engagement rate</span><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : t?.engagementRate == null ? '—' : `${t.engagementRate}%`}</div><div className="stat-foot"><Change value={t?.engagementRateChange ?? null} unit=" pts" empty={noData ? 'Sync needed' : 'New'} /><span className="stat-hint">engagements per view</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Published posts</span><span className="stat-icon"><Icon name="send" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : t?.published ?? 0}</div><div className="stat-foot"><Change value={t?.publishedChange ?? null} empty="New" /><span className="stat-hint">last {days} days</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Best channel</span><span className="stat-icon"><Icon name={best ? platform(best.provider) as 'instagram' : 'instagram'} size={15} /></span></div><div className="stat-value" style={{ fontSize: 22 }}>{loading ? '—' : best ? best.name || platformLabel(platform(best.provider)) : '—'}</div><div className="stat-foot"><span className="stat-change trend-flat">{best ? num(best.engagements) : channels.length ? 'No data yet' : 'No channels'}</span><span className="stat-hint">{best ? 'engagements' : 'by engagement'}</span></div></div>
    </section>
    <div className="dashboard-grid">
      <section className="card chart-card" aria-labelledby="reach-title">
        <div className="card-header">
          <div><h3 className="card-title" id="reach-title">Views and engagement</h3><p className="card-subtitle">{noData ? 'Insights appear here after your first sync with Meta.' : `Daily totals across all connected channels, last ${days} days.`}</p><div className="chart-legend" aria-hidden="true"><span className="legend-item"><i className="legend-dot" /> Views</span><span className="legend-item"><i className="legend-dot light" /> Engagements</span></div></div>
          <button className="card-action" type="button" onClick={exportReport} disabled={!data?.series.length} aria-live="polite">{exported ? 'Copied to clipboard' : 'Export CSV'} <Icon name="external" size={12} /></button>
        </div>
        <div className="chart-wrap">
          {loading ? <div className="empty-state" aria-busy="true">Crunching your numbers…</div>
            : noData ? <div className="empty-state"><div className="empty-icon"><Icon name="chart" size={18} /></div><strong>No insights yet</strong>{channels.length ? 'Run a sync to pull views and engagement from Meta.' : 'Connect a channel to start collecting insights.'}</div>
            : <TrendChart series={data!.series} />}
        </div>
      </section>
      <section className="card health-card" aria-labelledby="mix-title">
        <div className="card-header"><div><h3 className="card-title" id="mix-title">Channel mix</h3><p className="card-subtitle">Share of engagements by connected account.</p></div><span className="list-count">{channels.length}</span></div>
        <div className="channel-list" style={{ paddingTop: 17 }}>
          {loading && <div className="empty-state" aria-busy="true">Crunching your numbers…</div>}
          {!loading && channels.map((c) => (
            <div className="channel-row" key={c.accountId} style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={`platform-avatar ${platform(c.provider)}`} aria-hidden="true"><Icon name={platform(c.provider) as 'instagram'} size={15} /></span>
                <div className="channel-copy"><strong>{c.name || 'Connected account'}</strong><span title={c.error ?? undefined}>{platformLabel(platform(c.provider))} · {c.error ? 'Sync issue, try reconnecting' : !c.syncedAt ? 'Awaiting first sync' : `${num(c.views)} views${c.followers != null ? ` · ${num(c.followers)} followers` : ''}`}</span></div>
                <strong style={{ color: 'var(--text-2)', fontSize: 11 }}>{c.share}%</strong>
              </div>
              <div className="mix-bar" role="progressbar" aria-valuenow={c.share} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name || 'Account'} share of engagements`}><i style={{ width: `${c.share}%` }} /></div>
            </div>
          ))}
          {!loading && !channels.length && <div className="empty-state"><div className="empty-icon"><Icon name="chart" size={18} /></div><strong>Connect channels to see insights</strong>Your performance report will appear here.<br /><a className="card-action" href="/connect">Connect a channel <Icon name="arrow-right" size={13} /></a></div>}
        </div>
      </section>
    </div>
    <div className="bottom-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <section className="card upcoming-card" aria-labelledby="top-title" style={{ minHeight: 0 }}>
        <div className="card-header"><div><h3 className="card-title" id="top-title">Top posts</h3><p className="card-subtitle">Most engaging posts published in the last {days} days.</p></div></div>
        <div className="upcoming-list">
          {!loading && data?.topPosts.map((p) => {
            const pf = platform(p.platform);
            return (
              <div className="upcoming-item" key={p.id}>
                <span className={`platform-avatar ${pf}`} aria-hidden="true"><Icon name={pf as 'instagram'} size={16} /></span>
                <div className="upcoming-copy"><strong>{p.caption || `${p.mediaType.toLowerCase()} post`}</strong><span>{platformLabel(pf)} · {shortDate(p.publishedAt)} · {num(p.views)} views{p.permalink && <> · <a href={p.permalink} target="_blank" rel="noreferrer">View post</a></>}</span></div>
                <span className="upcoming-time">{num(p.engagements)} eng.</span>
              </div>
            );
          })}
          {!loading && !data?.topPosts.length && <div className="empty-state">No post insights for this period yet.</div>}
        </div>
      </section>
    </div>
  </div>;
}
