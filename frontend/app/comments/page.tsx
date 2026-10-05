'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';
import { errorText, platformFor, platformName } from '../../lib/format';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Event = { id: string; accountId?: string | null; platform: string; commentId: string; senderId?: string | null; text?: string | null; replied: boolean; dmSent: boolean; createdAt: string };

const REPLY_LIMIT = 500;

function initials(value?: string | null) { return (value || 'Creator').replace(/[^a-z0-9 ]/gi, '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function when(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Comments() {
  const [events, setEvents] = useState<Event[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<'all' | 'needs'>('needs');
  const [loadError, setLoadError] = useState('');
  const [replyingTo, setReplyingTo] = useState<Event | null>(null);
  const [form, setForm] = useState({ accountId: '', platform: 'instagram', commentId: '', text: '', dm: false });
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setLoadError('');
    try {
      const [eventData, accountData] = await Promise.all([api<Event[]>('/comments/events'), api<Account[]>('/accounts')]);
      setEvents(eventData);
      setAccounts(accountData);
    } catch (error) { setLoadError(errorText(error, 'Could not load the inbox.')); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);

  const replyable = accounts.filter((account) => account.provider !== 'threads');

  // Picking a comment fills in the account and comment for the reply form.
  const startReply = (event: Event) => {
    const account = accounts.find((a) => a.id === event.accountId) || replyable.find((a) => platformFor(a.provider) === platformFor(event.platform));
    setReplyingTo(event);
    setForm((f) => ({ ...f, commentId: event.commentId, accountId: account?.id || f.accountId, platform: platformFor(account?.provider || event.platform) }));
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const reply = async (event: FormEvent) => {
    event.preventDefault(); setSending(true);
    try {
      await api('/comments/reply', { method: 'POST', body: JSON.stringify({ ...form, dm: Boolean(form.dm) }) });
      setForm({ ...form, commentId: '', text: '' });
      setReplyingTo(null);
      toast.success(form.dm ? 'Private reply sent' : 'Reply posted');
      await load(true);
    } catch (error) { toast.error(errorText(error, 'Could not send this reply.')); }
    finally { setSending(false); }
  };

  const needsReply = events.filter((event) => !event.replied).length;
  const visible = useMemo(() => (tab === 'needs' ? events.filter((e) => !e.replied) : events), [events, tab]);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Conversation inbox</div><h1>Stay close to your audience</h1><p>Reply to comments and send private follow-ups without leaving your workspace.</p></div>
      <div className="page-intro-actions"><span className={needsReply ? 'status-pill status-pending' : 'live-pill'}>{!needsReply && <i aria-hidden="true" />}{needsReply ? `${needsReply} need${needsReply === 1 ? 's' : ''} a reply` : 'All caught up'}</span></div>
    </section>
    {loadError && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {loadError}<button className="card-action" type="button" onClick={() => load()} style={{ marginLeft: 'auto' }}>Try again</button></div>}
    <div className="split-layout split-layout-reverse">
      <section className="card data-card" aria-labelledby="activity-title">
        <div className="card-header">
          <div><h2 className="card-title" id="activity-title">Comments <span className="list-count">{events.length}</span></h2><p className="card-subtitle">Incoming comments from your connected channels. Pick one to reply.</p></div>
          <button className="icon-btn" type="button" onClick={() => load(true)} aria-label="Refresh comments" disabled={refreshing}><Icon name="refresh" size={14} className={refreshing ? 'spin' : ''} /></button>
        </div>
        <div className="inbox-toolbar">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'needs')}>
            <TabsList aria-label="Inbox filter">
              <TabsTrigger value="needs">Needs reply{needsReply > 0 ? ` · ${needsReply}` : ''}</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ul className="inbox-list">
          {loading && [0, 1, 2].map((i) => <li key={i} className="skeleton skeleton-row" aria-hidden="true" />)}
          {!loading && visible.map((event) => {
            const platform = platformFor(event.platform);
            const selected = replyingTo?.id === event.id;
            return (
              <li className={`inbox-item ${selected ? 'selected' : ''}`} key={event.id}>
                <div className="comment-avatar" aria-hidden="true">{initials(event.senderId)}</div>
                <div className="inbox-copy">
                  <div className="inbox-meta"><strong>{event.senderId || 'Social user'}</strong><time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>{when(event.createdAt)}</time></div>
                  <p>{event.text || 'New comment received.'}</p>
                  <div className="inbox-foot">
                    <span className={`platform-avatar platform-avatar-xs ${platform}`}><Icon name={platform} size={11} /><span className="sr-only">{platformName(platform)}</span></span>
                    {event.replied ? <span className="replied-label"><Icon name="check" size={12} /> Replied{event.dmSent ? ' · DM sent' : ''}</span> : <span className="status-pill status-pending">Needs reply</span>}
                    {!event.replied && platform !== 'threads' && <button className="btn btn-sm btn-soft inbox-reply" type="button" onClick={() => startReply(event)} aria-pressed={selected}><Icon name="send" size={12} /> Reply</button>}
                  </div>
                </div>
              </li>
            );
          })}
          {!loading && visible.length === 0 && <li className="empty-state"><div className="empty-icon"><Icon name="inbox" size={18} /></div><strong>{tab === 'needs' ? 'All caught up' : 'Your inbox is quiet'}</strong>{tab === 'needs' ? 'Every comment has a reply.' : accounts.length ? 'New comments from connected channels will appear here.' : <>Connect a channel to start receiving comments.<br /><Link className="card-action" href="/connect">Connect a channel <Icon name="arrow-right" size={13} /></Link></>}</li>}
        </ul>
      </section>

      <section className="card form-card reply-card" aria-labelledby="reply-title">
        <div className="card-header"><div><h2 className="card-title" id="reply-title">{replyingTo ? `Reply to ${replyingTo.senderId || 'this comment'}` : 'Send a reply'}</h2><p className="card-subtitle">{replyingTo ? `“${(replyingTo.text || '').slice(0, 120)}${(replyingTo.text || '').length > 120 ? '…' : ''}”` : 'Pick a comment to reply to it, or paste a comment ID.'}</p></div>{replyingTo && <button className="icon-btn" type="button" aria-label="Clear selected comment" onClick={() => { setReplyingTo(null); setForm({ ...form, commentId: '' }); }}><Icon name="x" size={14} /></button>}</div>
        <form className="form-grid" onSubmit={reply}>
          <div className="field"><label className="field-label" htmlFor="comment-account">From account</label><select id="comment-account" value={form.accountId} onChange={(event) => { const account = accounts.find((item) => item.id === event.target.value); setForm({ ...form, accountId: event.target.value, platform: platformFor(account?.provider) }); }} required><option value="">Choose an account</option>{replyable.map((account) => <option key={account.id} value={account.id}>{account.name || account.externalId} · {platformName(account.provider)}</option>)}</select></div>
          {!replyingTo && <div className="field"><label className="field-label" htmlFor="comment-id">Comment ID</label><input className="code-input" id="comment-id" placeholder="e.g. 179421…" value={form.commentId} onChange={(event) => setForm({ ...form, commentId: event.target.value })} required inputMode="numeric" /></div>}
          <div className="field">
            <label className="field-label" htmlFor="comment-text">Your message <span className={`char-count ${form.text.length >= REPLY_LIMIT ? 'over' : ''}`}>{form.text.length}/{REPLY_LIMIT}</span></label>
            <textarea ref={textRef} id="comment-text" rows={4} placeholder="Write something thoughtful…" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value.slice(0, REPLY_LIMIT) })} required />
          </div>
          <label className="check-row"><input type="checkbox" checked={form.dm} onChange={(event) => setForm({ ...form, dm: event.target.checked })} /><span><strong>Send as a private message</strong><small>Instagram private replies stay between you and the commenter.</small></span></label>
          <div className="form-actions"><button className="btn" type="submit" disabled={sending || loading || !replyable.length}><Icon name="send" size={15} /> {sending ? 'Sending…' : form.dm ? 'Send private reply' : 'Post reply'}</button>{!replyable.length && !loading && <span className="form-hint">Connect Instagram or Facebook to reply.</span>}</div>
        </form>
      </section>
    </div>
  </div>;
}
