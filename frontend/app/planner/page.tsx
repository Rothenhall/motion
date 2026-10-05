'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';
import { errorText, formatName, platformFor, platformName, statusName } from '../../lib/format';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Post = { id: string; platform: string; mediaType: string; caption?: string | null; scheduledAt: string; status: string; account?: { provider: string; name?: string | null } };
type View = 'week' | 'month';

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day key, so a post at 11pm lands on the day the user sees. */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function startOfWeek(d: Date) {
  const day = startOfDay(d);
  const offset = (day.getDay() + 6) % 7; // Monday first
  return new Date(day.getTime() - offset * DAY_MS);
}
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function postPlatform(post: Post) { return platformFor(post.account?.provider || post.platform); }
const time = (value: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function Planner() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('week');
  const [filter, setFilter] = useState('all');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    api<Post[]>('/posts').then(setPosts).catch((e) => setError(errorText(e, 'Could not load your posts.'))).finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => (filter === 'all' ? posts : posts.filter((p) => postPlatform(p) === filter)), [posts, filter]);
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of visible) {
      const key = dayKey(new Date(post.scheduledAt));
      map.set(key, [...(map.get(key) || []), post]);
    }
    return map;
  }, [visible]);

  const todayKey = dayKey(new Date());
  const days = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(first);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const count = Math.ceil(((last.getTime() - start.getTime()) / DAY_MS + 1) / 7) * 7;
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [anchor, view]);

  const rangeTitle = view === 'month'
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor)
    : `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(days[0])} – ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(days[6])}`;

  const step = (dir: 1 | -1) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  const perDay = view === 'week' ? 4 : 2;
  const upcoming = useMemo(() => visible.filter((p) => new Date(p.scheduledAt).getTime() >= Date.now() - DAY_MS).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)), [visible]);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Publishing calendar</div><h1>Content planner</h1><p>Every scheduled post across your channels. Pick an open day to plan something for it.</p></div>
      <div className="page-intro-actions">
        <Link className="btn" href="/?compose=true"><Icon name="plus" size={16} /> Create post</Link>
      </div>
    </section>

    {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}

    <section className="card planner-card" aria-labelledby="range-title">
      <div className="planner-toolbar">
        <div className="planner-toolbar-left">
          <button className="icon-btn" type="button" aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)}><Icon name="chevron-right" size={14} className="rotate-180" /></button>
          <button className="icon-btn" type="button" aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)}><Icon name="chevron-right" size={14} /></button>
          <h2 className="month-title" id="range-title" aria-live="polite">{rangeTitle}</h2>
          <button className="toolbar-filter" type="button" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
        </div>
        <div className="planner-toolbar-right">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList aria-label="Calendar view">
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
          <select className="select-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by channel">
            <option value="all">All channels</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="threads">Threads</option>
          </select>
        </div>
      </div>
      <div className="calendar-scroll">
        <div className={`week-grid ${view === 'month' ? 'month-grid' : ''}`}>
          {days.slice(0, 7).map((day) => <div className="weekday" key={`h-${day.getDay()}`} aria-hidden="true">{weekdayShort.format(day)}</div>)}
          {days.map((day) => {
            const key = dayKey(day);
            const items = byDay.get(key) || [];
            const past = key < todayKey;
            const outside = view === 'month' && day.getMonth() !== anchor.getMonth();
            return (
              <div className={`day-column ${key === todayKey ? 'today' : ''} ${outside ? 'outside' : ''} ${past ? 'past' : ''}`} key={key}>
                <div className="day-number"><span className="sr-only">{dayLong.format(day)}{key === todayKey ? ', today' : ''}, </span><span aria-hidden="true">{day.getDate()}</span><span className="sr-only">{items.length ? `${items.length} post${items.length === 1 ? '' : 's'}` : 'nothing scheduled'}</span></div>
                {loading && view === 'week' && <div className="skeleton" style={{ height: 52, marginBottom: 8 }} aria-hidden="true" />}
                {!loading && items.slice(0, perDay).map((post) => {
                  const platform = postPlatform(post);
                  return <div className={`calendar-event ${platform}`} key={post.id} title={`${post.caption || formatName(post.mediaType)} · ${platformName(platform)} · ${time(post.scheduledAt)}`}><strong>{post.caption || `${formatName(post.mediaType)} post`}</strong><span><i className="event-dot" aria-hidden="true" />{time(post.scheduledAt)} · {statusName(post.status)}</span></div>;
                })}
                {!loading && items.length > perDay && <span className="more-events">+{items.length - perDay} more</span>}
                {!loading && !past && items.length === 0 && (
                  <Link className="day-add" href={`/?compose=true&date=${key}`} aria-label={`Schedule a post on ${dayLong.format(day)}`}><Icon name="plus" size={13} /><span>Add</span></Link>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>

    <section className="card" style={{ marginTop: 16 }} aria-labelledby="queue-title">
      <div className="card-header"><div><h2 className="card-title" id="queue-title">Upcoming queue</h2><p className="card-subtitle">Everything scheduled from today on, soonest first.</p></div><span className="list-count">{upcoming.length} post{upcoming.length === 1 ? '' : 's'}</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Content</th><th scope="col">Channel</th><th scope="col">Publish time</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {upcoming.map((post) => {
              const platform = postPlatform(post);
              return (
                <tr key={post.id}>
                  <td><div className="table-main"><span className={`platform-avatar ${platform}`} aria-hidden="true"><Icon name={platform} size={14} /></span><div><strong>{post.caption || `${formatName(post.mediaType)} post`}</strong><span>{formatName(post.mediaType)}</span></div></div></td>
                  <td className="table-secondary">{platformName(platform)}{post.account?.name ? ` · ${post.account.name}` : ''}</td>
                  <td className="table-secondary">{new Date(post.scheduledAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td><span className={`status-pill status-${post.status.toLowerCase()}`}>{statusName(post.status)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <div className="empty-state" aria-busy="true">Loading your queue…</div>}
        {!loading && upcoming.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="send" size={18} /></div><strong>Nothing scheduled{filter !== 'all' ? ` for ${platformName(filter)}` : ''}</strong>Your next post will appear here.<br /><Link className="card-action" href="/?compose=true">Schedule a post <Icon name="arrow-right" size={13} /></Link></div>}
      </div>
    </section>
  </div>;
}
