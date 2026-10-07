'use client';

import { Select } from '@/components/ui/select';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../components/Icons';
import Insight from '../../components/studio/Insight';
import PostDrawer from '../../components/studio/PostDrawer';
import Thumb from '../../components/studio/Thumb';
import { api } from '../../lib/api';
import { errorText, formatName, platformName } from '../../lib/format';
import { ApprovalBadge } from '../../components/approvals/ApprovalBadge';
import { approvalView } from '../../lib/approvals';
import '../../components/approvals/approvals.css';
import { addDays, dayKey, fmtTime, needsMedia, postPlatform, postStatusLabel, reschedule, startOfDay, startOfWeek, type Post } from '../../lib/posts';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type View = 'week' | 'month';
type PostStat = { id: string; publishedAt: string; engagements: number | null; views: number | null };

// Calendar rows are parts of the day: posting time matters at this grain, and it keeps a week readable on one screen.
const PARTS = [
  { id: 'morning', label: 'Morning', from: 5, to: 11, drop: 9 },
  { id: 'midday', label: 'Midday', from: 11, to: 15, drop: 12 },
  { id: 'afternoon', label: 'Afternoon', from: 15, to: 19, drop: 16 },
  { id: 'evening', label: 'Evening', from: 19, to: 23, drop: 19 },
  { id: 'night', label: 'Late', from: 23, to: 29, drop: 22 },
] as const;
const partOf = (d: Date) => {
  const h = d.getHours() < 5 ? d.getHours() + 24 : d.getHours();
  return PARTS.find((p) => h >= p.from && h < p.to)!.id;
};
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export default function Planner() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [stats, setStats] = useState<PostStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('week');
  const [filter, setFilter] = useState('all');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [open, setOpen] = useState<Post | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Post[]>('/posts').then(setPosts).catch((e) => setError(errorText(e, 'Could not load your posts.'))).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    api<{ postStats?: PostStat[] }>('/analytics?days=90').then((a) => setStats(a?.postStats || [])).catch(() => setStats([]));
  }, [load]);

  const visible = useMemo(() => (filter === 'all' ? posts : posts.filter((p) => postPlatform(p) === filter)), [posts, filter]);

  // Best times: which weekday and part of day earned the most engagement, from every post that has insights.
  const best = useMemo(() => {
    const score = new Map<string, number>();
    let measured = 0;
    for (const t of stats) {
      if (!t.engagements) continue;
      const d = new Date(t.publishedAt);
      const key = `${d.getDay()}-${partOf(d)}`;
      score.set(key, (score.get(key) || 0) + t.engagements);
      measured++;
    }
    const max = Math.max(0, ...score.values());
    const hot = new Set<string>();
    if (measured >= 3) for (const [k, v] of score) if (v >= max * 0.6) hot.add(k);
    return { hot, measured };
  }, [stats]);

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const post of visible) {
      const key = dayKey(new Date(post.scheduledAt));
      map.set(key, [...(map.get(key) || []), post].sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)));
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
    const count = Math.ceil(((last.getTime() - start.getTime()) / 86_400_000 + 1) / 7) * 7;
    return Array.from({ length: count }, (_, i) => addDays(start, i));
  }, [anchor, view]);

  const rangeTitle = view === 'month'
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(anchor)
    : `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(days[0])} – ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(days[6])}`;
  const step = (dir: 1 | -1) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  const upcoming = useMemo(() => visible.filter((p) => new Date(p.scheduledAt).getTime() >= Date.now() - 86_400_000).sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)), [visible]);

  const weekCount = view === 'week' ? days.reduce((n, d) => n + (byDay.get(dayKey(d))?.length || 0), 0) : 0;
  const needFix = visible.filter(needsMedia);

  const undo = async (post: Post, back: Date) => {
    try { await reschedule(post, back); toast.success('Move undone'); }
    catch (e) { toast.error(errorText(e, 'Could not undo the move.')); }
    load();
  };

  // Drop a scheduled post on another day (and part of day): same clock time unless the part changes.
  const drop = async (day: Date, partId?: string) => {
    const post = posts.find((p) => p.id === dragId);
    setDragId(null); setOverKey(null);
    if (!post || post.status !== 'SCHEDULED') return;
    const from = new Date(post.scheduledAt);
    const part = partId ? PARTS.find((p) => p.id === partId)! : null;
    const target = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.getHours(), from.getMinutes());
    if (part && partOf(from) !== part.id) { target.setHours(part.drop % 24, 0, 0, 0); }
    if (target.getTime() === from.getTime()) return;
    if (target.getTime() < Date.now()) { toast.error('That time has already passed.', { description: 'Pick a later slot.' }); return; }
    try {
      await reschedule(post, target);
      load();
      toast.success('Rescheduled', {
        description: `${post.caption ? post.caption.slice(0, 40) : formatName(post.mediaType)} · ${dayLong.format(target)}, ${fmtTime(target)}`,
        action: { label: 'Undo', onClick: () => undo(post, from) },
      });
    } catch (e) { toast.error(errorText(e, 'Could not move this post.')); }
  };

  // Feed preview: the Instagram profile as it will look, with scheduled posts outlined.
  const feed = useMemo(() => {
    const ig = posts.filter((p) => postPlatform(p) === 'instagram' && p.status !== 'FAILED');
    const sched = ig.filter((p) => p.status === 'SCHEDULED' || p.status === 'PENDING_APPROVAL').sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt));
    const done = ig.filter((p) => p.status === 'PUBLISHED').sort((a, b) => +new Date(b.scheduledAt) - +new Date(a.scheduledAt));
    return [...sched, ...done].slice(0, 12);
  }, [posts]);
  const feedAccount = posts.find((p) => postPlatform(p) === 'instagram')?.account?.name;

  const dayHeader = (day: Date) => {
    const key = dayKey(day);
    return <div className={`pl-h ${key === todayKey ? 'today' : ''}`} key={`h-${key}`}><span>{weekdayShort.format(day)}</span><b>{day.getDate()}</b></div>;
  };

  return <div className="pl">
    <section className="page-intro">
      <div><div className="eyebrow">Publishing calendar</div><h1>Content planner</h1><p>Every scheduled post across your channels. Drag a post to another day to reschedule it.</p></div>
      <div className="page-intro-actions">
        <Link className="btn" href="/?compose=true"><Icon name="plus" size={16} /> Create post</Link>
      </div>
    </section>

    {error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {error}</div>}
    {!loading && needFix.length > 0 && (
      <div className="ov-brief"><Insight action={<button className="st-chip dark" type="button" onClick={() => setOpen(needFix[0])}>Fix now</button>}><b>{needFix.length} scheduled {needFix.length === 1 ? 'post has' : 'posts have'} no media</b> and will fail to publish.</Insight></div>
    )}

    <PostDrawer post={open} onOpenChange={(o) => !o && setOpen(null)} onChanged={load} />

    <div className="pl-layout">
      <section className="card planner-card" aria-labelledby="range-title">
        <div className="planner-toolbar">
          <div className="planner-toolbar-left">
            <button className="icon-btn" type="button" aria-label={view === 'week' ? 'Previous week' : 'Previous month'} onClick={() => step(-1)}><Icon name="chevron-right" size={14} className="rotate-180" /></button>
            <button className="icon-btn" type="button" aria-label={view === 'week' ? 'Next week' : 'Next month'} onClick={() => step(1)}><Icon name="chevron-right" size={14} /></button>
            <h2 className="month-title" id="range-title" aria-live="polite">{rangeTitle}</h2>
            <button className="toolbar-filter" type="button" onClick={() => setAnchor(startOfDay(new Date()))}>Today</button>
          </div>
          <div className="planner-toolbar-right">
            {best.hot.size > 0 ? <span className="st-chip good" title="Shaded from the engagement your published posts earned">Best times shaded</span> : <span className="st-chip" title="Needs three published posts with insights">Best times: {best.measured}/3 posts measured</span>}
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList aria-label="Calendar view">
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select className="select-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by channel">
              <option value="all">All channels</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="threads">Threads</option>
            </Select>
          </div>
        </div>

        <div className="calendar-scroll">
          {view === 'week' ? (
            <div className="pl-week" role="grid" aria-label="Week calendar">
              <div className="pl-corner" />
              {days.map(dayHeader)}
              {PARTS.map((part) => (
                <div className="pl-row" key={part.id} role="row">
                  <div className="pl-part">{part.label}<small>{part.from % 24}:00</small></div>
                  {days.map((day) => {
                    const key = dayKey(day);
                    const items = (byDay.get(key) || []).filter((p) => partOf(new Date(p.scheduledAt)) === part.id);
                    const hot = best.hot.has(`${day.getDay()}-${part.id}`);
                    const cell = `${key}-${part.id}`;
                    const past = day < startOfDay(new Date());
                    return (
                      <div
                        key={cell}
                        role="gridcell"
                        className={`pl-cell ${hot ? 'hot' : ''} ${past ? 'past' : ''} ${overKey === cell ? 'over' : ''} ${key === todayKey ? 'today' : ''}`}
                        onDragOver={(e) => { if (dragId && !past) { e.preventDefault(); setOverKey(cell); } }}
                        onDragLeave={() => setOverKey((k) => (k === cell ? null : k))}
                        onDrop={(e) => { e.preventDefault(); drop(day, part.id); }}
                      >
                        {loading && !items.length && part.id === 'morning' && <div className="skeleton" style={{ height: 44 }} aria-hidden="true" />}
                        {items.map((p) => <EventCard key={p.id} post={p} dragging={dragId === p.id} onOpen={() => setOpen(p)} onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOverKey(null); }} />)}
                        {!loading && !past && items.length === 0 && (
                          <Link className="pl-add" href={`/?compose=true&date=${key}`} aria-label={`Schedule a post on ${dayLong.format(day)}, ${part.label.toLowerCase()}`}><Icon name="plus" size={12} /></Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="week-grid month-grid">
              {days.slice(0, 7).map((day) => <div className="weekday" key={`h-${day.getDay()}`} aria-hidden="true">{weekdayShort.format(day)}</div>)}
              {days.map((day) => {
                const key = dayKey(day);
                const items = byDay.get(key) || [];
                const past = key < todayKey;
                const outside = day.getMonth() !== anchor.getMonth();
                return (
                  <div
                    className={`day-column ${key === todayKey ? 'today' : ''} ${outside ? 'outside' : ''} ${past ? 'past' : ''} ${overKey === key ? 'over' : ''}`}
                    key={key}
                    onDragOver={(e) => { if (dragId && !past) { e.preventDefault(); setOverKey(key); } }}
                    onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                    onDrop={(e) => { e.preventDefault(); drop(day); }}
                  >
                    <div className="day-number"><span className="sr-only">{dayLong.format(day)}{key === todayKey ? ', today' : ''}, </span><span aria-hidden="true">{day.getDate()}</span><span className="sr-only">{items.length ? `${items.length} post${items.length === 1 ? '' : 's'}` : 'nothing scheduled'}</span></div>
                    <div className="pl-minis">
                      {items.slice(0, 4).map((p) => (
                        <button key={p.id} type="button" className={`pl-mini ${apClass(p)}`} draggable={p.status === 'SCHEDULED'} onDragStart={() => setDragId(p.id)} onDragEnd={() => { setDragId(null); setOverKey(null); }} onClick={() => setOpen(p)} aria-label={`${p.caption || formatName(p.mediaType)}, ${fmtTime(p.scheduledAt)}, ${postStatusLabel(p)}`}>
                          <Thumb id={p.id} media={p.mediaUrls} mediaType={p.mediaType} caption={p.caption} ratio="1 / 1" />
                        </button>
                      ))}
                    </div>
                    {items.length > 4 && <span className="more-events">+{items.length - 4} more</span>}
                    {!loading && !past && items.length === 0 && <Link className="day-add" href={`/?compose=true&date=${key}`} aria-label={`Schedule a post on ${dayLong.format(day)}`}><Icon name="plus" size={13} /><span>Add</span></Link>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {view === 'week' && !loading && weekCount === 0 && <p className="pl-note">Nothing is scheduled this week. Pick a slot to plan something for it.</p>}
      </section>

      <aside className="pl-feed card" aria-labelledby="feed-t">
        <div className="pl-feed-top"><h2 id="feed-t" className="ov-eyebrow">Feed preview</h2><span className="st-chip"><Icon name="instagram" size={11} /> Instagram</span></div>
        {feed.length ? (
          <>
            <div className="pl-prof"><span className="st-phone-av" /><div><b>{feedAccount || 'Your account'}</b><span className="muted">{feed.filter((p) => p.status === 'SCHEDULED').length} scheduled · outlined{feed.some((p) => p.status === 'PENDING_APPROVAL') ? ` · ${feed.filter((p) => p.status === 'PENDING_APPROVAL').length} awaiting approval (dashed)` : ''}</span></div></div>
            <div className="pl-grid">
              {feed.map((p) => <button key={p.id} type="button" className={`pl-feed-item ${p.status === 'SCHEDULED' ? 'new' : ''} ${apClass(p)}`} onClick={() => setOpen(p)} aria-label={`${p.caption || formatName(p.mediaType)}, ${postStatusLabel(p)}`}><Thumb id={p.id} media={p.mediaUrls} mediaType={p.mediaType} caption={p.caption} ratio="4 / 5" className="pl-feed-thumb" /></button>)}
            </div>
            <p className="pl-feed-note">Newest first. Outlined posts are still scheduled.</p>
          </>
        ) : <p className="pl-feed-note">Your Instagram posts appear here, so you can plan how the profile looks, not only when posts go out.</p>}
      </aside>
    </div>

    <section className="card" style={{ marginTop: 16 }} aria-labelledby="queue-title">
      <div className="card-header"><div><h2 className="card-title" id="queue-title">Upcoming queue</h2><p className="card-subtitle">Everything scheduled from today on, soonest first.</p></div><span className="list-count">{upcoming.length} post{upcoming.length === 1 ? '' : 's'}</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th scope="col">Content</th><th scope="col">Channel</th><th scope="col">Publish time</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {upcoming.map((post) => {
              const platform = postPlatform(post);
              return (
                <tr key={post.id} className="pl-qrow" onClick={() => setOpen(post)}>
                  <td><div className="table-main"><Thumb id={post.id} media={post.mediaUrls} mediaType={post.mediaType} caption={post.caption} className="pl-qthumb" /><div><strong>{post.caption || `${formatName(post.mediaType)} post`}</strong><span>{formatName(post.mediaType)}</span></div></div></td>
                  <td className="table-secondary">{platformName(platform)}{post.account?.name ? ` · ${post.account.name}` : ''}</td>
                  <td className="table-secondary">{new Date(post.scheduledAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td>{approvalView(post) ? <ApprovalBadge post={post} /> : <span className={`status-pill status-${post.status.toLowerCase()}`}>{postStatusLabel(post)}</span>}</td>
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

/** Class that marks awaiting, changes-requested and approved posts apart from plain scheduled ones. */
const apClass = (post: Post) => { const v = approvalView(post); return v ? `ap-${v}` : ''; };

function EventCard({ post, dragging, onOpen, onDragStart, onDragEnd }: { post: Post; dragging: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const platform = postPlatform(post);
  const movable = post.status === 'SCHEDULED';
  const warn = post.status === 'FAILED' || needsMedia(post);
  return (
    <button
      type="button"
      className={`pl-ev ${platform} ${apClass(post)} ${dragging ? 'dragging' : ''} ${warn ? 'warn' : ''} ${movable ? 'movable' : ''}`}
      draggable={movable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', post.id); onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={`${post.caption || formatName(post.mediaType)} · ${platformName(platform)} · ${fmtTime(post.scheduledAt)}`}
    >
      <Thumb id={post.id} media={post.mediaUrls} mediaType={post.mediaType} caption={post.caption} className="pl-ev-thumb" />
      <span className="pl-ev-copy"><strong>{post.caption || `${formatName(post.mediaType)} post`}</strong><span>{fmtTime(post.scheduledAt)} · {warn ? (post.status === 'FAILED' ? 'Failed' : 'Needs media') : postStatusLabel(post)}</span></span>
    </button>
  );
}
