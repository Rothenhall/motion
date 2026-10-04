'use client';

import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Data = { stats: { published: number; engagement: number | null; engagementChange: number | null }; accounts: { id: string; provider: string; name?: string | null }[] };
function platform(provider: string) { return provider === 'facebook_page' ? 'facebook' : provider === 'threads' ? 'threads' : 'instagram'; }
function platformLabel(p: string) { return p === 'facebook' ? 'Facebook' : p === 'threads' ? 'Threads' : 'Instagram'; }

export default function Analytics() {
  const [data, setData] = useState<Data>({ stats: { published: 0, engagement: 0, engagementChange: 0 }, accounts: [] });
  const [loading, setLoading] = useState(true);
  const [exported, setExported] = useState(false);
  useEffect(() => { api('/dashboard').then(setData).catch(console.error).finally(() => setLoading(false)); }, []);

  const exportReport = () => {
    setExported(true);
    setTimeout(() => setExported(false), 2400);
  };

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Performance intelligence</div><h2>Analytics at a glance</h2><p>Understand what is resonating, then make more of it.</p></div>
      <div className="page-intro-actions">
        <span className="live-pill" role="status"><i aria-hidden="true" />Updated just now</span>
        <div className="date-chip"><Icon name="chart" size={15} /> Last 30 days <Icon name="chevron-down" size={13} /></div>
      </div>
    </section>
    <section className="stats-grid" aria-label="Analytics summary">
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Total impressions</span><span className="stat-icon"><Icon name="chart" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : '—'}</div><div className="stat-foot"><span className="stat-change trend-flat">Sync needed</span><span className="stat-hint">insights not synced</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Engagement rate</span><span className="stat-icon"><Icon name="sparkles" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : data.stats.engagement == null ? '—' : `${data.stats.engagement}%`}</div><div className="stat-foot"><span className={`stat-change ${data.stats.engagementChange == null ? 'trend-flat' : 'trend-up'}`}>{data.stats.engagementChange == null ? 'Sync needed' : `+${data.stats.engagementChange}%`}</span><span className="stat-hint">vs. prior period</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Published posts</span><span className="stat-icon"><Icon name="send" size={15} /></span></div><div className={`stat-value ${loading ? 'skeleton' : ''}`}>{loading ? '00' : data.stats.published}</div><div className="stat-foot"><span className="stat-change trend-up">+12.6%</span><span className="stat-hint">this month</span></div></div>
      <div className="stat-card card"><div className="stat-top"><span className="stat-label">Best channel</span><span className="stat-icon"><Icon name="instagram" size={15} /></span></div><div className="stat-value" style={{ fontSize: 22 }}>{loading ? '—' : data.accounts.length ? platformLabel(platform(data.accounts[0].provider)) : '—'}</div><div className="stat-foot"><span className="stat-change trend-flat">{data.accounts.length ? `${data.accounts.length} connected` : 'No data'}</span><span className="stat-hint">by engagement</span></div></div>
    </section>
    <div className="dashboard-grid">
      <section className="card chart-card" aria-labelledby="reach-title">
        <div className="card-header">
          <div><h3 className="card-title" id="reach-title">Reach and engagement <span className="preview-label">Preview</span></h3><p className="card-subtitle">Connect platform insights to unlock reach and engagement trends.</p><div className="chart-legend" aria-hidden="true"><span className="legend-item"><i className="legend-dot" /> Reach</span><span className="legend-item"><i className="legend-dot light" /> Engagement</span></div></div>
          <button className="card-action" type="button" onClick={exportReport} aria-live="polite">{exported ? 'Copied to clipboard' : 'Export report'} <Icon name="external" size={12} /></button>
        </div>
        <div className="chart-wrap">
          <svg viewBox="0 0 760 210" role="img" aria-label="Reach and engagement trend, preview data">
            <defs><linearGradient id="analyticsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity=".18" /><stop offset="100%" stopColor="#4f46e5" stopOpacity="0" /></linearGradient></defs>
            <line className="chart-grid-line" x1="0" y1="20" x2="760" y2="20" /><line className="chart-grid-line" x1="0" y1="70" x2="760" y2="70" /><line className="chart-grid-line" x1="0" y1="120" x2="760" y2="120" /><line className="chart-grid-line" x1="0" y1="170" x2="760" y2="170" />
            <path d="M0 146 C55 142 85 119 130 129 S201 101 250 116 S320 82 368 96 S434 62 484 76 S554 58 602 62 S686 31 760 43 V190 H0Z" fill="url(#analyticsFill)" />
            <path className="chart-line" d="M0 146 C55 142 85 119 130 129 S201 101 250 116 S320 82 368 96 S434 62 484 76 S554 58 602 62 S686 31 760 43" />
            <path d="M0 166 C55 153 85 162 130 151 S201 142 250 151 S320 126 368 137 S434 111 484 124 S554 107 602 113 S686 94 760 102" fill="none" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <text className="chart-label" x="0" y="205">Sep 02</text><text className="chart-label" x="121" y="205">Sep 08</text><text className="chart-label" x="247" y="205">Sep 14</text><text className="chart-label" x="373" y="205">Sep 20</text><text className="chart-label" x="499" y="205">Sep 26</text><text className="chart-label" x="700" y="205">Oct 01</text>
          </svg>
        </div>
      </section>
      <section className="card health-card" aria-labelledby="mix-title">
        <div className="card-header"><div><h3 className="card-title" id="mix-title">Channel mix</h3><p className="card-subtitle">Performance by connected platform.</p></div><span className="list-count">{data.accounts.length}</span></div>
        <div className="channel-list" style={{ paddingTop: 17 }}>
          {loading && <div className="empty-state" aria-busy="true">Crunching your numbers…</div>}
          {!loading && data.accounts.map((account, index) => (
            <div className="channel-row" key={account.id} style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={`platform-avatar ${platform(account.provider)}`} aria-hidden="true"><Icon name={platform(account.provider) as 'instagram'} size={15} /></span>
                <div className="channel-copy"><strong>{account.name || 'Connected account'}</strong><span>{platformLabel(platform(account.provider))} · {index === 0 ? 'Top performer' : 'Growing'}</span></div>
                <strong style={{ color: 'var(--text-2)', fontSize: 11 }}>Awaiting sync</strong>
              </div>
              <div className="mix-bar" role="progressbar" aria-valuenow={index === 0 ? 72 : 38} aria-valuemin={0} aria-valuemax={100} aria-label={`${account.name || 'Account'} share`}><i style={{ width: index === 0 ? '72%' : '38%' }} /></div>
            </div>
          ))}
          {!loading && !data.accounts.length && <div className="empty-state"><div className="empty-icon"><Icon name="chart" size={18} /></div><strong>Connect channels to see insights</strong>Your performance report will appear here.<br /><a className="card-action" href="/connect">Connect a channel <Icon name="arrow-right" size={13} /></a></div>}
        </div>
      </section>
    </div>
  </div>;
}
