'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icons';
import Composer from '../components/Composer';
import TrendChart, { TrendPoint } from '../components/TrendChart';
import { api } from '../lib/api';
import { errorText, formatName, platformFor, platformName } from '../lib/format';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Post = { id: string; platform: string; mediaType: string; caption?: string | null; scheduledAt: string; status: string; error?: string | null; account?: Account };
type DashboardData = { stats: { scheduled: number; published: number; failed: number }; upcomingPosts: Post[]; accounts: Account[]; automationCount: number; activeAutomationCount: number };
type Analytics = { hasInsights: boolean; series: TrendPoint[]; totals: { engagementRate: number | null; engagementRateChange: number | null } };

const emptyDashboard: DashboardData = { stats: { scheduled: 0, published: 0, failed: 0 }, upcomingPosts: [], accounts: [], automationCount: 0, activeAutomationCount: 0 };

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function Home() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [handoff, setHandoff] = useState<{ caption?: string; day?: string | null }>({});

  const load = async () => {
    setLoadError('');
    try {
      setData(await api('/dashboard'));
    } catch (error) {
      setLoadError(errorText(error, 'Could not load your workspace.'));
    } finally { setLoading(false); }
    api<Analytics>('/analytics?days=30').then(setAnalytics).catch(() => setAnalytics(null));
  };

  useEffect(() => {
    load();
    // Ideas, hooks and the planner open the composer through ?compose=true&caption=…&date=…
    const params = new URLSearchParams(window.location.search);
    if (params.get('compose') === 'true') {
      setHandoff({ caption: params.get('caption') || undefined, day: params.get('date') });
      setComposerOpen(true);
      // Drop the params so a refresh doesn't reopen the composer.
      window.history.replaceState(null, '', '/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const todayLabel = useMemo(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()), []);

  // Same 30-day figure the Analytics page shows, from synced Meta insights.
  const engagement = analytics?.hasInsights ? analytics.totals.engagementRate : null;
  const engagementChange = analytics?.hasInsights ? analytics.totals.engagementRateChange : null;
  const stats = [
    { label: 'Scheduled posts', value: data.stats.scheduled, hint: 'waiting in your queue', icon: 'calendar' as const, href: '/planner' },
    { label: 'Published this month', value: data.stats.published, hint: data.stats.failed ? `${data.stats.failed} failed` : 'no failures', icon: 'send' as const, href: '/planner', warn: data.stats.failed > 0 },
    { label: 'Engagement rate', value: engagement == null ? '—' : `${engagement}%`, hint: engagement == null ? 'sync insights to see this' : 'last 30 days, all channels', icon: 'chart' as const, href: '/analytics', change: engagementChange },
    { label: 'Active automations', value: data.activeAutomationCount, hint: `of ${data.automationCount} rule${data.automationCount === 1 ? '' : 's'}`, icon: 'zap' as const, href: '/automations' },
  ];

  const hasInsights = !!analytics?.hasInsights && analytics.series.length > 0;
  const openComposer = () => { setHandoff({}); setComposerOpen(true); };

  return (
    <div>
      <section className="page-intro dashboard-intro">
        <div>
          <div className="eyebrow">{todayLabel}</div>
          <h1>{greeting}</h1>
          <p>Here&apos;s what&apos;s moving across your social channels.</p>
        </div>
        <div className="page-intro-actions">
          <button className="btn" type="button" onClick={openComposer} aria-haspopup="dialog">
            <Icon name="plus" size={16} /> Create post
          </button>
        </div>
      </section>

      {loadError && (
        <div className="notice notice-error" role="alert">
          <Icon name="alert" size={15} /> {loadError}
          <button className="card-action" type="button" onClick={() => { setLoading(true); load(); }} style={{ marginLeft: 'auto' }}>Try again</button>
        </div>
      )}

      <Composer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        accounts={data.accounts}
        accountsLoading={loading}
        initialCaption={handoff.caption}
        initialDay={handoff.day}
        onScheduled={load}
      />

      <section className="stats-grid" aria-label="Workspace summary">
        {stats.map((stat) => (
          <Link className="stat-card card stat-link" key={stat.label} href={stat.href}>
            <div className="stat-top"><span className="stat-label">{stat.label}</span><span className="stat-icon"><Icon name={stat.icon} size={15} /></span></div>
            <div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : stat.value}</div>
            <div className="stat-foot">
              {stat.change != null && <span className={`stat-change ${stat.change >= 0 ? 'trend-up' : 'trend-warn'}`}>{stat.change >= 0 ? '+' : ''}{stat.change} pts</span>}
              <span className={`stat-hint ${stat.warn ? 'stat-hint-warn' : ''}`}>{stat.hint}</span>
            </div>
          </Link>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="card chart-card" aria-labelledby="engagement-title">
          <div className="card-header">
            <div>
              <h2 className="card-title" id="engagement-title">Performance, last 30 days</h2>
              <p className="card-subtitle">{hasInsights ? 'Daily views and engagements across your channels.' : 'Your trend appears here after the first insights sync.'}</p>
              {hasInsights && <div className="chart-legend" aria-hidden="true"><span className="legend-item"><i className="legend-dot" /> Views</span><span className="legend-item"><i className="legend-dot light" /> Engagements</span></div>}
            </div>
            <Link className="card-action" href="/analytics">Open analytics <Icon name="arrow-right" size={13} /></Link>
          </div>
          <div className="chart-wrap">
            {analytics === null && loading ? <div className="skeleton" style={{ height: 180 }} aria-hidden="true" />
              : hasInsights ? <TrendChart series={analytics!.series} id="overview" />
                : (
                  <div className="empty-state">
                    <div className="empty-icon"><Icon name="chart" size={18} /></div>
                    <strong>No insights yet</strong>
                    {data.accounts.length ? 'Sync your channels from Analytics to pull views and engagement from Meta.' : 'Connect a channel and Motion will start collecting views and engagement.'}
                    <br /><Link className="card-action" href={data.accounts.length ? '/analytics' : '/connect'}>{data.accounts.length ? 'Go to analytics' : 'Connect a channel'} <Icon name="arrow-right" size={13} /></Link>
                  </div>
                )}
          </div>
        </section>

        <section className="card upcoming-card" aria-labelledby="upnext-title">
          <div className="card-header">
            <div><h2 className="card-title" id="upnext-title">Up next</h2><p className="card-subtitle">The next posts in your publishing queue.</p></div>
            <Link className="card-action" href="/planner">View planner <Icon name="arrow-right" size={13} /></Link>
          </div>
          <ul className="upcoming-list">
            {data.upcomingPosts.slice(0, 4).map((post) => {
              const platform = platformFor(post.account?.provider || post.platform);
              return (
                <li className="upcoming-item" key={post.id}>
                  <span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform} size={16} /></span>
                  <div className="upcoming-copy"><strong>{post.caption || `${formatName(post.mediaType)} post`}</strong><span>{platformName(platform)} · {formatDate(post.scheduledAt)}</span></div>
                  <span className="upcoming-time">{formatTime(post.scheduledAt)}</span>
                </li>
              );
            })}
            {!loading && data.upcomingPosts.length === 0 && (
              <li className="empty-state">
                <div className="empty-icon"><Icon name="calendar" size={18} /></div>
                <strong>Your queue is clear</strong>
                Schedule your next idea to keep momentum going.
                <br /><button className="card-action" type="button" onClick={openComposer}>Schedule a post <Icon name="arrow-right" size={13} /></button>
              </li>
            )}
            {loading && [0, 1, 2].map((i) => <li key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          </ul>
        </section>
      </div>

      <div className="bottom-grid">
        <section className="card health-card" aria-labelledby="health-title">
          <div className="card-header">
            <div><h2 className="card-title" id="health-title">Automations</h2><p className="card-subtitle">Rules that answer comments and send DMs for you.</p></div>
            <Link className="card-action" href="/automations">Manage rules <Icon name="arrow-right" size={13} /></Link>
          </div>
          {loading ? <div className="skeleton" style={{ height: 80, margin: '16px 22px 22px' }} aria-hidden="true" />
            : data.automationCount === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Icon name="zap" size={18} /></div>
                <strong>No rules yet</strong>
                Reply to keyword comments and send a DM automatically.
                <br /><Link className="card-action" href="/automations">Create your first rule <Icon name="arrow-right" size={13} /></Link>
              </div>
            ) : (
              <div className="health-body">
                <div className="automation-count"><strong>{data.activeAutomationCount}</strong><span>of {data.automationCount} live</span></div>
                <div className="health-copy">
                  <strong>{data.activeAutomationCount === data.automationCount ? 'Every rule is live' : data.activeAutomationCount === 0 ? 'All rules are paused' : `${data.automationCount - data.activeAutomationCount} paused`}</strong>
                  <p>{data.activeAutomationCount
                    ? `${data.activeAutomationCount} rule${data.activeAutomationCount === 1 ? ' is' : 's are'} watching comments and replying on your behalf.`
                    : 'Nothing is replying automatically right now. Turn a rule back on from Automations.'}</p>
                </div>
              </div>
            )}
        </section>
        <section className="card channels-card" aria-labelledby="channels-title">
          <div className="card-header">
            <div><h2 className="card-title" id="channels-title">Connected channels</h2><p className="card-subtitle">Where Motion can publish and listen.</p></div>
            <Link className="card-action" href="/connect">Manage <Icon name="arrow-right" size={13} /></Link>
          </div>
          <ul className="channel-list">
            {data.accounts.slice(0, 3).map((account) => {
              const platform = platformFor(account.provider);
              return (
                <li className="channel-row" key={account.id}>
                  <span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform} size={15} /></span>
                  <div className="channel-copy"><strong>{account.name || account.externalId}</strong><span>{platformName(platform)}</span></div>
                  <span className="channel-connected">Connected</span>
                </li>
              );
            })}
            {!loading && !data.accounts.length && (
              <li className="empty-state">
                <div className="empty-icon"><Icon name="link" size={18} /></div>
                <strong>No channels yet</strong>
                <Link className="card-action" href="/connect">Connect your first account <Icon name="arrow-right" size={13} /></Link>
              </li>
            )}
            {loading && [0, 1].map((i) => <li key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          </ul>
        </section>
      </div>
    </div>
  );
}
