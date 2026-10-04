'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { API, api, authHeaders } from '../lib/api';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Post = { id: string; platform: string; mediaType: string; caption?: string | null; scheduledAt: string; status: string; error?: string | null; account?: Account };
type DashboardData = { stats: { scheduled: number; published: number; failed: number; engagement: number | null; engagementChange: number | null }; upcomingPosts: Post[]; accounts: Account[]; automationCount: number; activeAutomationCount: number };

const emptyDashboard: DashboardData = { stats: { scheduled: 0, published: 0, failed: 0, engagement: 0, engagementChange: 0 }, upcomingPosts: [], accounts: [], automationCount: 0, activeAutomationCount: 0 };

function platformFor(provider: string) {
  if (provider === 'facebook_page' || provider === 'facebook') return 'facebook';
  if (provider === 'threads') return 'threads';
  return 'instagram';
}

function platformName(platform: string) {
  return platform === 'facebook' ? 'Facebook' : platform === 'threads' ? 'Threads' : 'Instagram';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export default function Home() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ accountId: '', platform: 'instagram', mediaType: 'IMAGE', caption: '', mediaUrls: '', scheduledAt: '' });
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mediaList = useMemo(() => form.mediaUrls.split('\n').map((u) => u.trim()).filter(Boolean), [form.mediaUrls]);

  const attachFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploadError('');
    setUploading(true);
    try {
      const urls: string[] = [];
      let kind = '';
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append('file', file);
        const res = await fetch(`${API}/media/upload`, { method: 'POST', body, headers: authHeaders() });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Upload failed.');
        }
        const data = await res.json();
        urls.push(data.url);
        kind = data.kind || kind;
      }
      const next = [...mediaList, ...urls].join('\n');
      setForm((f) => ({
        ...f,
        mediaUrls: next,
        mediaType: kind === 'VIDEO' && f.mediaType === 'IMAGE' ? 'VIDEO' : f.mediaType,
      }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not upload that file.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeMedia = (url: string) => {
    setForm((f) => ({ ...f, mediaUrls: f.mediaUrls.split('\n').map((u) => u.trim()).filter((u) => u && u !== url).join('\n') }));
  };

  const load = async () => {
    setLoading(true);
    try {
      setData(await api('/dashboard'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load workspace data.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('compose') === 'true') setComposerOpen(true);
    // Ideas and hooks hand their text over through ?caption= so the composer opens pre-filled.
    const caption = params.get('caption');
    if (caption) setForm((current) => ({ ...current, caption }));
  }, []);

  useEffect(() => {
    if (!composerOpen) return;
    captionRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComposerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [composerOpen]);

  const { greeting, todayLabel, monthLabel } = useMemo(() => {
    const now = new Date();
    const h = now.getHours();
    return {
      greeting: h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening',
      todayLabel: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now),
      monthLabel: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now),
    };
  }, []);

  const firstAccount = data.accounts[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice('');
    setSaving(true);
    try {
      await api('/posts', { method: 'POST', body: JSON.stringify({ ...form, mediaUrls: form.mediaUrls.split('\n').map((url) => url.trim()).filter(Boolean) }) });
      setForm({ ...form, caption: '', mediaUrls: '' });
      setComposerOpen(false);
      setNotice('Your post is scheduled and ready to publish.');
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not schedule this post.');
    } finally { setSaving(false); }
  };

  const stats = [
    { label: 'Scheduled posts', value: data.stats.scheduled, hint: 'in your queue', icon: 'calendar' as const, change: '+8.4%', tone: 'trend-up' },
    { label: 'Published this month', value: data.stats.published, hint: 'vs. last month', icon: 'send' as const, change: '+12.6%', tone: 'trend-up' },
    { label: 'Engagement rate', value: data.stats.engagement == null ? '—' : `${data.stats.engagement}%`, hint: data.stats.engagement == null ? 'insights not synced' : 'across all channels', icon: 'chart' as const, change: data.stats.engagementChange == null ? 'Sync needed' : `+${data.stats.engagementChange}%`, tone: data.stats.engagementChange == null ? 'trend-flat' : 'trend-up' },
    { label: 'Active automations', value: data.activeAutomationCount, hint: `${data.automationCount} rules created`, icon: 'zap' as const, change: 'Healthy', tone: 'trend-up' },
  ];

  const isSuccess = notice.includes('scheduled');

  return (
    <div>
      <section className="page-intro dashboard-intro">
        <div>
          <div className="eyebrow">{todayLabel}</div>
          <h2>{greeting}, Nitish</h2>
          <p>Here&apos;s what&apos;s moving across your social channels today.</p>
        </div>
        <div className="page-intro-actions">
          <span className="live-pill" role="status"><i aria-hidden="true" />All systems live</span>
          <div className="date-chip" aria-label={`Current month: ${monthLabel}`}><Icon name="calendar" size={15} /> {monthLabel} <Icon name="chevron-down" size={13} /></div>
          <button className="btn" type="button" onClick={() => setComposerOpen((open) => !open)} aria-expanded={composerOpen} aria-controls="composer-panel">
            <Icon name="plus" size={16} /> Create post
          </button>
        </div>
      </section>

      {notice && (
        <div className={`notice ${isSuccess ? 'notice-success' : 'notice-error'}`} role="alert" aria-live="polite">
          <Icon name={isSuccess ? 'check' : 'alert'} size={15} /> {notice}
        </div>
      )}

      {composerOpen && (
        <section className="composer-card card" id="composer-panel" role="dialog" aria-modal="false" aria-label="Compose a new post">
          <div className="composer-heading">
            <div><h3>Compose a new post</h3><p>One idea, ready for every channel.</p></div>
            <button className="icon-btn" type="button" onClick={() => setComposerOpen(false)} aria-label="Close composer">×</button>
          </div>
          <form className="form-grid" onSubmit={submit}>
            <div className="form-row">
              <div className="field">
                <label className="field-label" htmlFor="account">Publish from</label>
                <select id="account" value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })} required>
                  <option value="">Select a connected account</option>
                  {data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name || account.externalId} · {platformName(platformFor(account.provider))}</option>)}
                </select>
              </div>
              <div className="field"><label className="field-label" htmlFor="platform">Channel</label><select id="platform" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value })}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="threads">Threads</option></select></div>
              <div className="field"><label className="field-label" htmlFor="mediaType">Format</label><select id="mediaType" value={form.mediaType} onChange={(event) => setForm({ ...form, mediaType: event.target.value })}>{['TEXT', 'IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'].map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
              <div className="field"><label className="field-label" htmlFor="scheduledAt">Publish date</label><input id="scheduledAt" type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label className="field-label" htmlFor="caption">Caption</label><textarea ref={captionRef} id="caption" placeholder="Tell your story…" value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} rows={3} /></div>
              <div className="field"><label className="field-label" htmlFor="mediaUrls">Media URLs <span className="muted">(optional)</span></label><textarea id="mediaUrls" placeholder="One public https URL per line" value={form.mediaUrls} onChange={(event) => setForm({ ...form, mediaUrls: event.target.value })} rows={3} /></div>
            </div>
            <div className="form-actions" style={{ marginTop: 2 }}>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" multiple className="sr-only" aria-label="Attach photos or video" onChange={(e) => attachFiles(e.target.files)} />
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
                <Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Add photos / video'}
              </button>
              <span className="form-hint">JPG, PNG, WebP, GIF or MP4 · up to 100 MB — or paste a URL below</span>
            </div>
            {uploadError && <div className="form-error" role="alert">{uploadError}</div>}
            {mediaList.length > 0 && (
              <div className="attach-grid" aria-label="Attached media">
                {mediaList.map((url) => (
                  <div className="attach-item" key={url}>
                    {url.match(/\.(mp4|mov)(\?|$)/i)
                      ? <span className="attach-video"><Icon name="play" size={16} /> Video</span>
                      : <img src={url} alt="Attached media preview" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                    <button className="attach-remove" type="button" onClick={() => removeMedia(url)} aria-label="Remove attachment">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="form-actions">
              <button className="btn" type="submit" disabled={saving || uploading || loading || !data.accounts.length}>
                <Icon name="calendar" size={15} /> {saving ? 'Scheduling…' : 'Schedule post'}
              </button>
              <a className="btn btn-ghost" href={`/preflight?${new URLSearchParams([...mediaList.filter((u) => u.includes('/media/')).map((u) => ['media', u]), ['caption', form.caption], ['platform', form.platform]]).toString()}`}>
                <Icon name="gauge" size={15} /> Check before posting
              </a>
              <button className="btn btn-ghost" type="button" onClick={() => setComposerOpen(false)}>Cancel</button>
              {!data.accounts.length && !loading && <span className="form-error">Connect an account first to schedule.</span>}
            </div>
          </form>
        </section>
      )}

      <section className="stats-grid" aria-label="Workspace summary">
        {stats.map((stat) => (
          <div className="stat-card card" key={stat.label}>
            <div className="stat-top"><span className="stat-label">{stat.label}</span><span className="stat-icon"><Icon name={stat.icon} size={15} /></span></div>
            <div className={`stat-value ${loading ? 'skeleton' : ''}`} aria-live="polite">{loading ? '00' : stat.value}</div>
            <div className="stat-foot"><span className={`stat-change ${stat.tone}`}>{stat.change}</span><span className="stat-hint">{stat.hint}</span></div>
          </div>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="card chart-card" aria-labelledby="engagement-title">
          <div className="card-header">
            <div>
              <h3 className="card-title" id="engagement-title">Audience engagement <span className="preview-label">Preview</span></h3>
              <p className="card-subtitle">Connect platform insights to unlock your real performance trend.</p>
              <div className="chart-legend" aria-hidden="true"><span className="legend-item"><i className="legend-dot" /> Engagement</span><span className="legend-item"><i className="legend-dot light" /> Reach</span></div>
            </div>
            <button className="card-action" type="button">Last 30 days <Icon name="chevron-down" size={13} /></button>
          </div>
          <div className="chart-wrap">
            <svg viewBox="0 0 760 210" role="img" aria-label="Engagement trend chart, up 18.4 percent over the last 30 days">
              <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4f46e5" stopOpacity=".18" /><stop offset="100%" stopColor="#4f46e5" stopOpacity="0" /></linearGradient></defs>
              <line className="chart-grid-line" x1="0" y1="20" x2="760" y2="20" /><line className="chart-grid-line" x1="0" y1="70" x2="760" y2="70" /><line className="chart-grid-line" x1="0" y1="120" x2="760" y2="120" /><line className="chart-grid-line" x1="0" y1="170" x2="760" y2="170" />
              <path className="chart-fill" d="M0 143 C50 136 70 147 112 127 S180 119 224 133 S284 89 335 104 S397 118 446 89 S505 76 558 83 S612 52 657 64 S714 35 760 45 V190 H0Z" />
              <path className="chart-line" d="M0 143 C50 136 70 147 112 127 S180 119 224 133 S284 89 335 104 S397 118 446 89 S505 76 558 83 S612 52 657 64 S714 35 760 45" />
              <circle className="chart-point" cx="558" cy="83" r="4" /><rect className="chart-callout" x="530" y="45" width="57" height="22" rx="5" /><text className="chart-callout-text" x="542" y="59">+18.4%</text>
              <text className="chart-label" x="0" y="205">Sep 02</text><text className="chart-label" x="121" y="205">Sep 08</text><text className="chart-label" x="247" y="205">Sep 14</text><text className="chart-label" x="373" y="205">Sep 20</text><text className="chart-label" x="499" y="205">Sep 26</text><text className="chart-label" x="625" y="205">Oct 01</text>
            </svg>
          </div>
        </section>

        <section className="card upcoming-card" aria-labelledby="upnext-title">
          <div className="card-header">
            <div><h3 className="card-title" id="upnext-title">Up next</h3><p className="card-subtitle">The next posts in your publishing queue.</p></div>
            <a className="card-action" href="/planner">View planner <Icon name="arrow-right" size={13} /></a>
          </div>
          <div className="upcoming-list">
            {data.upcomingPosts.slice(0, 4).map((post) => {
              const platform = platformFor(post.account?.provider || post.platform);
              return (
                <div className="upcoming-item" key={post.id}>
                  <span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform as 'instagram'} size={16} /></span>
                  <div className="upcoming-copy"><strong>{post.caption || `${post.mediaType.toLowerCase()} post`}</strong><span>{platformName(platform)} · {formatDate(post.scheduledAt)}</span></div>
                  <span className="upcoming-time">{formatTime(post.scheduledAt)}</span>
                </div>
              );
            })}
            {!loading && data.upcomingPosts.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon"><Icon name="calendar" size={18} /></div>
                <strong>Your queue is clear</strong>
                Schedule your next idea to keep momentum going.
                <br /><button className="card-action" type="button" onClick={() => setComposerOpen(true)}>Schedule a post <Icon name="arrow-right" size={13} /></button>
              </div>
            )}
            {loading && <div className="empty-state" aria-busy="true">Loading your publishing queue…</div>}
          </div>
        </section>
      </div>

      <div className="bottom-grid">
        <section className="card health-card" aria-labelledby="health-title">
          <div className="card-header">
            <div><h3 className="card-title" id="health-title">Automation health</h3><p className="card-subtitle">Your engagement engine is running smoothly.</p></div>
            <a className="card-action" href="/automations">Manage rules <Icon name="arrow-right" size={13} /></a>
          </div>
          <div className="health-body">
            <div className="health-ring" role="img" aria-label="Automation health 86 percent"><div className="health-ring-content"><strong>86%</strong><span>healthy</span></div></div>
            <div className="health-copy">
              <strong>Everything is in sync</strong>
              <p>{data.activeAutomationCount} active rules are watching comments and sending replies on your behalf.</p>
              <div className="health-check"><Icon name="check" size={13} /> Last checked just now</div>
            </div>
          </div>
        </section>
        <section className="card channels-card" aria-labelledby="channels-title">
          <div className="card-header">
            <div><h3 className="card-title" id="channels-title">Connected channels</h3><p className="card-subtitle">Ready to publish from anywhere.</p></div>
            <a className="card-action" href="/connect">Manage <Icon name="arrow-right" size={13} /></a>
          </div>
          <div className="channel-list">
            {data.accounts.slice(0, 3).map((account) => {
              const platform = platformFor(account.provider);
              return (
                <div className="channel-row" key={account.id}>
                  <span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform as 'instagram'} size={15} /></span>
                  <div className="channel-copy"><strong>{account.name || account.externalId}</strong><span>{platformName(platform)}</span></div>
                  <span className="channel-connected">Connected</span>
                </div>
              );
            })}
            {!loading && !data.accounts.length && (
              <div className="empty-state">
                <div className="empty-icon"><Icon name="link" size={18} /></div>
                <strong>No channels yet</strong>
                <a className="card-action" href="/connect">Connect your first account <Icon name="arrow-right" size={13} /></a>
              </div>
            )}
            {loading && <div className="empty-state" aria-busy="true">Syncing channels…</div>}
          </div>
        </section>
      </div>

      {firstAccount && <span className="sr-only">Primary account: {firstAccount.name || firstAccount.externalId}</span>}
    </div>
  );
}
