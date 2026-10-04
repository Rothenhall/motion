'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Post = { id: string; platform: string; mediaType: string; caption?: string | null; scheduledAt: string; status: string; account?: { provider: string; name?: string | null } };
const days = [{ name: 'Mon', date: '28' }, { name: 'Tue', date: '29' }, { name: 'Wed', date: '30' }, { name: 'Thu', date: '01', today: true }, { name: 'Fri', date: '02' }, { name: 'Sat', date: '03' }, { name: 'Sun', date: '04' }];

function platformFor(post: Post) { return post.account?.provider === 'facebook_page' || post.platform === 'facebook' ? 'facebook' : post.account?.provider === 'threads' || post.platform === 'threads' ? 'threads' : 'instagram'; }
function time(value: string) { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function platformLabel(p: string) { return p === 'facebook' ? 'Facebook' : p === 'threads' ? 'Threads' : 'Instagram'; }

export default function Planner() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'week' | 'month'>('week');
  const [filter, setFilter] = useState('all');
  useEffect(() => { api('/posts').then(setPosts).catch(console.error).finally(() => setLoading(false)); }, []);
  const visible = useMemo(() => filter === 'all' ? posts : posts.filter((p) => platformFor(p) === filter), [posts, filter]);
  const eventsFor = (date: string) => visible.filter((post) => new Date(post.scheduledAt).getDate().toString().padStart(2, '0') === date).slice(0, 3);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Publishing calendar</div><h2>Content planner</h2><p>See every idea, campaign, and channel in one calm view.</p></div>
      <div className="page-intro-actions">
        <span className="live-pill" role="status"><i aria-hidden="true" />{posts.length} scheduled</span>
        <a className="btn btn-ghost" href="/">View overview</a>
        <a className="btn" href="/?compose=true"><Icon name="plus" size={16} /> Create post</a>
      </div>
    </section>
    <section className="card planner-card" aria-label="Publishing calendar">
      <div className="planner-toolbar">
        <div className="planner-toolbar-left">
          <button className="icon-btn" type="button" aria-label="Previous week"><Icon name="chevron-right" size={14} className="rotate-180" /></button>
          <button className="icon-btn" type="button" aria-label="Next week"><Icon name="chevron-right" size={14} /></button>
          <h3 className="month-title">October 2026</h3>
          <button className="toolbar-filter" type="button">Today</button>
        </div>
        <div className="planner-toolbar-right" role="tablist" aria-label="Calendar view">
          <button className={`toolbar-filter ${view === 'week' ? 'active' : ''}`} type="button" role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}>Week</button>
          <button className={`toolbar-filter ${view === 'month' ? 'active' : ''}`} type="button" role="tab" aria-selected={view === 'month'} onClick={() => setView('month')}>Month</button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by channel" style={{ height: 32, width: 'auto', fontSize: 12 }}>
            <option value="all">All channels</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="threads">Threads</option>
          </select>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div className="week-grid" role="grid" aria-label={view === 'week' ? 'Week view' : 'Month view'}>
          <>{days.map((day) => <div className="weekday" key={day.date} role="columnheader">{day.name}</div>)}</>
          {days.map((day) => (
            <div className={`day-column ${day.today ? 'today' : ''}`} key={day.name} role="gridcell" aria-label={`${day.name} ${day.date}${day.today ? ', today' : ''}`}>
              <div className="day-number" aria-hidden="true">{day.date}</div>
              {loading && <div className="skeleton" style={{ height: 52, marginBottom: 8 }} aria-hidden="true" />}
              {!loading && eventsFor(day.date).map((post) => {
                const platform = platformFor(post);
                return <div className={`calendar-event ${platform}`} key={post.id} title={`${post.caption || post.mediaType} · ${platformLabel(platform)} · ${time(post.scheduledAt)}`}><strong>{post.caption || `${post.mediaType.toLowerCase()} post`}</strong><span><i className="event-dot" aria-hidden="true" />{time(post.scheduledAt)} · {post.status.toLowerCase()}</span></div>;
              })}
              {!loading && eventsFor(day.date).length === 0 && <span className="muted" style={{ fontSize: 11 }}>Open</span>}
            </div>
          ))}
        </div>
      </div>
      {!loading && posts.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="calendar" size={18} /></div><strong>Your calendar is ready for its first idea</strong>Connect a channel and schedule a post from the overview.<br /><a className="card-action" href="/?compose=true">Schedule a post <Icon name="arrow-right" size={13} /></a></div>}
    </section>
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="queue-title">
      <div className="card-header"><div><h3 className="card-title" id="queue-title">Queue details</h3><p className="card-subtitle">A list view of everything coming up next.</p></div><span className="list-count">{visible.length} posts</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Content</th><th scope="col">Channel</th><th scope="col">Publish time</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {visible.slice(0, 8).map((post) => (
              <tr key={post.id}>
                <td><div className="table-main"><span className={`platform-avatar ${platformFor(post)}`} aria-hidden="true"><Icon name={platformFor(post) as 'instagram'} size={14} /></span><div><strong>{post.caption || `${post.mediaType} post`}</strong><span>{post.mediaType}</span></div></div></td>
                <td className="table-secondary">{platformLabel(platformFor(post))}</td>
                <td className="table-secondary">{new Date(post.scheduledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                <td><span className={`status-pill status-${post.status.toLowerCase()}`}>{post.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="empty-state" aria-busy="true">Loading your queue…</div>}
        {!loading && visible.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="send" size={18} /></div><strong>No scheduled content{filter !== 'all' ? ` for ${platformLabel(filter)}` : ''}</strong>Your next post will appear here.</div>}
      </div>
    </section>
  </div>;
}
