'use client';

import { Select } from '@/components/ui/select';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../components/Icons';
import Thumb from '../../components/studio/Thumb';
import { api } from '../../lib/api';
import { errorText, platformFor, platformName } from '../../lib/format';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type EventPost = { id: string; caption?: string | null; mediaType: string; mediaUrls?: string; permalink?: string | null; publishedAt: string };
type Event = { id: string; accountId?: string | null; platform: string; commentId: string; senderId?: string | null; text?: string | null; replied: boolean; dmSent: boolean; createdAt: string; post?: EventPost | null };
type Filter = 'needs' | 'all' | 'done';

const REPLY_LIMIT = 500;
const DEFAULT_QUICK = ['Thank you so much, that means a lot!', 'Great question. I just sent you the details in a private message.', 'Appreciate you saying that. More coming soon.'];
const QUICK_KEY = 'motion-quick-replies';

function initials(value?: string | null) { return (value || 'Creator').replace(/[^a-z0-9 ]/gi, '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'C'; }
function when(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Comments() {
  const [events, setEvents] = useState<Event[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState<Filter>('needs');
  const [query, setQuery] = useState('');
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ accountId: '', platform: 'instagram', commentId: '', text: '', dm: false });
  const [quick, setQuick] = useState<string[]>(DEFAULT_QUICK);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { const saved = JSON.parse(window.localStorage.getItem(QUICK_KEY) || 'null'); if (Array.isArray(saved) && saved.length) setQuick(saved); } catch { /* storage unavailable */ }
  }, []);
  const saveQuick = (list: string[]) => { setQuick(list); try { window.localStorage.setItem(QUICK_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } };

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setLoadError('');
    try {
      const [eventData, accountData] = await Promise.all([api<Event[]>('/comments/events'), api<Account[]>('/accounts')]);
      setEvents(eventData || []);
      setAccounts(accountData || []);
    } catch (error) { setLoadError(errorText(error, 'Could not load the inbox.')); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const replyable = accounts.filter((account) => account.provider !== 'threads');
  const needsReply = events.filter((event) => !event.replied).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => (filter === 'all' ? true : filter === 'needs' ? !e.replied : e.replied) && (!q || (e.text || '').toLowerCase().includes(q) || (e.senderId || '').toLowerCase().includes(q)));
  }, [events, filter, query]);

  // Keep a conversation open: the first visible one unless the user picked another.
  const selected = visible.find((e) => e.id === selectedId) || visible[0] || null;
  const account = selected ? accounts.find((a) => a.id === selected.accountId) || replyable.find((a) => platformFor(a.provider) === platformFor(selected.platform)) : null;
  const platform = platformFor(selected?.platform);
  const canReply = !!selected && !selected.replied && platform !== 'threads';

  // Opening a different comment clears the draft's target so a reply never goes to the wrong person.
  useEffect(() => {
    if (!selected) return;
    setForm((f) => ({ ...f, commentId: selected.commentId, accountId: account?.id || f.accountId, platform: platformFor(account?.provider || selected.platform) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, account?.id]);

  const reply = async (event: FormEvent) => {
    event.preventDefault(); setSending(true);
    try {
      await api('/comments/reply', { method: 'POST', body: JSON.stringify({ ...form, dm: Boolean(form.dm) }) });
      setForm((f) => ({ ...f, text: '' }));
      toast.success(form.dm ? 'Private reply sent' : 'Reply posted');
      await load(true);
    } catch (error) { toast.error(errorText(error, 'Could not send this reply.')); }
    finally { setSending(false); }
  };

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: 'needs', label: 'Needs reply', count: needsReply },
    { id: 'all', label: 'All', count: events.length },
    { id: 'done', label: 'Done', count: events.length - needsReply },
  ];

  return <div className="ib">
    <section className="page-intro">
      <div><div className="eyebrow">Conversation inbox</div><h1>Stay close to your audience</h1><p>Reply to comments and send private follow-ups without leaving your workspace.</p></div>
      <div className="page-intro-actions"><span className={needsReply ? 'status-pill status-pending' : 'live-pill'}>{!needsReply && <i aria-hidden="true" />}{needsReply ? `${needsReply} need${needsReply === 1 ? 's' : ''} a reply` : 'All caught up'}</span></div>
    </section>
    {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}<button className="card-action" type="button" onClick={() => load()} style={{ marginLeft: 'auto' }}>Try again</button></div>}

    <div className="ib-panes">
      <section className="ib-list" aria-labelledby="ib-list-t">
        <h2 id="ib-list-t" className="sr-only">Conversations</h2>
        <div className="ib-filters" role="group" aria-label="Inbox filter">
          {filters.map((f) => <button key={f.id} type="button" className={`toolbar-filter ${filter === f.id ? 'active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}{f.count ? ` · ${f.count}` : ''}</button>)}
          <button className="icon-btn ib-refresh" type="button" onClick={() => load(true)} aria-label="Refresh comments" disabled={refreshing}><Icon name="refresh" size={14} className={refreshing ? 'spin' : ''} /></button>
        </div>
        <input className="ib-search" type="search" placeholder="Search comments or people" aria-label="Search comments" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="ib-convos">
          {loading && [0, 1, 2].map((i) => <li key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          {!loading && visible.map((event) => {
            const pf = platformFor(event.platform);
            return (
              <li key={event.id}>
                <button type="button" className={`ib-cv ${selected?.id === event.id ? 'on' : ''}`} onClick={() => setSelectedId(event.id)} aria-current={selected?.id === event.id}>
                  <span className="comment-avatar" aria-hidden="true">{initials(event.senderId)}</span>
                  <span className="ib-cv-body">
                    <span className="ib-cv-top"><strong>{event.senderId || 'Social user'}</strong><time dateTime={event.createdAt}>{when(event.createdAt)}</time></span>
                    <span className="ib-cv-text">{event.text || 'New comment received.'}</span>
                    <span className="ib-cv-foot"><Icon name={pf} size={11} /> {platformName(pf)}{event.replied ? <em className="ib-done"><Icon name="check" size={11} /> Replied</em> : <em className="ib-wait">Needs reply</em>}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {!loading && visible.length === 0 && <li className="ib-empty"><div className="empty-icon"><Icon name="inbox" size={18} /></div><strong>{filter === 'needs' ? 'All caught up' : 'Nothing here'}</strong><span>{filter === 'needs' ? 'Every comment has a reply.' : accounts.length ? 'New comments from connected channels will appear here.' : 'Connect a channel to start receiving comments.'}</span>{!accounts.length && <Link className="btn btn-sm" href="/connect">Connect a channel</Link>}</li>}
        </ul>
      </section>

      <section className="ib-thread" aria-labelledby="ib-thread-t">
        {selected ? (
          <>
            <header className="ib-thread-h">
              <span className="comment-avatar" aria-hidden="true">{initials(selected.senderId)}</span>
              <div><h2 id="ib-thread-t">{selected.senderId || 'Social user'}</h2><span className="muted">{platformName(platform)}{account?.name ? ` · ${account.name}` : ''} · {new Date(selected.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></div>
              {selected.replied ? <span className="st-chip good"><Icon name="check" size={11} /> Replied{selected.dmSent ? ' · DM sent' : ''}</span> : <span className="st-chip warn">Needs reply</span>}
            </header>
            <div className="ib-msgs">
              <div className="ib-msg">{selected.text || 'New comment received.'}</div>
              {selected.replied && <div className="ib-msg me">You replied{selected.dmSent ? ' and sent a private message.' : '.'}</div>}
            </div>
            {canReply ? (
              <form className="ib-reply" onSubmit={reply}>
                <div className="ib-quick" aria-label="Quick replies">
                  {quick.map((q) => <button key={q} type="button" className="st-chip" onClick={() => { setForm((f) => ({ ...f, text: q })); textRef.current?.focus(); }}>{q.length > 34 ? `${q.slice(0, 34)}…` : q}</button>)}
                </div>
                <textarea ref={textRef} id="comment-text" aria-label="Your reply" rows={3} placeholder="Write something thoughtful…" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value.slice(0, REPLY_LIMIT) })} required />
                <div className="ib-reply-bar">
                  <label className="check-row"><input type="checkbox" checked={form.dm} onChange={(e) => setForm({ ...form, dm: e.target.checked })} /><span><strong>Send as a private message</strong><small>One DM to the commenter, within 7 days.</small></span></label>
                  <span className={`char-count ${form.text.length >= REPLY_LIMIT ? 'over' : ''}`}>{form.text.length}/{REPLY_LIMIT}</span>
                  {form.text.trim() && !quick.includes(form.text.trim()) && <button className="btn btn-sm btn-ghost" type="button" onClick={() => saveQuick([form.text.trim(), ...quick].slice(0, 6))}>Save as quick reply</button>}
                  <button className="btn" type="submit" disabled={sending || loading || !account}><Icon name="send" size={15} /> {sending ? 'Sending…' : form.dm ? 'Send private reply' : 'Post reply'}</button>
                </div>
                {!account && !loading && <span className="form-hint">Connect Instagram or Facebook to reply.</span>}
              </form>
            ) : (
              <p className="ib-note">{selected.replied ? 'This comment has been replied to.' : 'Replies to Threads comments are not supported yet.'}</p>
            )}
          </>
        ) : (
          <div className="ib-none"><strong>No conversation selected</strong><span>Pick a comment on the left to read it and reply.</span></div>
        )}
      </section>

      <aside className="ib-ctx" aria-label="Conversation details">
        <div className="ov-eyebrow">Details</div>
        {selected?.post && (
          <div className="ib-post">
            <Thumb id={selected.post.id} media={selected.post.mediaUrls} mediaType={selected.post.mediaType} caption={selected.post.caption} ratio="4 / 3" />
            <div className="ib-post-copy"><b>{selected.post.caption ? selected.post.caption.slice(0, 80) : 'Your post'}</b><span>Published {new Date(selected.post.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
            {selected.post.permalink && <a className="inline-link" href={selected.post.permalink} target="_blank" rel="noreferrer">Open post<span className="sr-only"> (opens in a new tab)</span></a>}
          </div>
        )}
        {selected ? (
          <dl>
            <div><dt>Person</dt><dd>{selected.senderId || 'Unknown'}</dd></div>
            <div><dt>Channel</dt><dd>{platformName(platform)}{account?.name ? ` · ${account.name}` : ''}</dd></div>
            <div><dt>Received</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div>
            <div><dt>Status</dt><dd>{selected.replied ? `Replied${selected.dmSent ? ' with a DM' : ''}` : 'Waiting for your reply'}</dd></div>
            <div><dt>Comment ID</dt><dd className="code-input">{selected.commentId}</dd></div>
          </dl>
        ) : <p className="ov-stat-note">Details about the selected conversation appear here.</p>}
        <details className="inline-details ib-manual">
          <summary>Reply to a comment by ID</summary>
          <form className="form-grid" onSubmit={reply}>
            <div className="field"><label className="field-label" htmlFor="comment-account">From account</label><Select id="comment-account" value={form.accountId} onChange={(event) => { const acc = accounts.find((item) => item.id === event.target.value); setForm({ ...form, accountId: event.target.value, platform: platformFor(acc?.provider) }); }} required><option value="">Choose an account</option>{replyable.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId} · {platformName(a.provider)}</option>)}</Select></div>
            <div className="field"><label className="field-label" htmlFor="comment-id">Comment ID</label><input className="code-input" id="comment-id" placeholder="e.g. 179421…" value={form.commentId} onChange={(event) => setForm({ ...form, commentId: event.target.value })} required inputMode="numeric" /></div>
            <div className="field"><label className="field-label" htmlFor="comment-text-manual">Message</label><textarea id="comment-text-manual" rows={3} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value.slice(0, REPLY_LIMIT) })} required /></div>
            <button className="btn btn-sm" type="submit" disabled={sending || !replyable.length}>{sending ? 'Sending…' : 'Send'}</button>
          </form>
        </details>
      </aside>
    </div>
  </div>;
}
