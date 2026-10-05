'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icons';
import { api } from '../../lib/api';

type Account = { id: string; provider: string; externalId: string; name?: string | null };
type Event = { id: string; platform: string; commentId: string; senderId?: string | null; text?: string | null; replied: boolean; dmSent: boolean; createdAt: string };

function channel(provider: string) { return provider === 'facebook_page' ? 'Facebook' : provider === 'threads' ? 'Threads' : 'Instagram'; }
function initials(value?: string | null) { return (value || 'Creator').replace(/[^a-z0-9 ]/gi, '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }
function when(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function Comments() {
  const [events, setEvents] = useState<Event[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<'all' | 'needs'>('all');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ accountId: '', platform: 'instagram', commentId: '', text: '', dm: false });
  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try { const [eventData, accountData] = await Promise.all([api('/comments/events'), api('/accounts')]); setEvents(eventData); setAccounts(accountData); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load the inbox.'); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);
  const reply = async (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setSending(true);
    try { await api('/comments/reply', { method: 'POST', body: JSON.stringify({ ...form, dm: Boolean(form.dm) }) }); setForm({ ...form, commentId: '', text: '' }); setNotice('Reply sent successfully.'); await load(true); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not send this reply.'); }
    finally { setSending(false); }
  };

  const needsReply = events.filter((event) => !event.replied).length;
  const visible = useMemo(() => tab === 'needs' ? events.filter((e) => !e.replied) : events, [events, tab]);
  const isSuccess = /successfully/i.test(notice);

  return <div>
    <section className="page-intro">
      <div><div className="eyebrow">Conversation inbox</div><h2>Stay close to your audience</h2><p>Reply to comments and send private follow-ups without leaving your workspace.</p></div>
      <div className="page-intro-actions"><span className="live-pill" role="status"><i aria-hidden="true" />{needsReply} need{needsReply === 1 ? 's' : ''} a reply</span></div>
    </section>
    {notice && <div className={`notice ${isSuccess ? 'notice-success' : 'notice-error'}`} role="alert" aria-live="polite"><Icon name={isSuccess ? 'check' : 'alert'} size={15} /> {notice}</div>}
    <div className="split-layout">
      <section className="card form-card" aria-labelledby="reply-title">
        <div className="card-header"><div><h3 className="card-title" id="reply-title">Send a reply</h3><p className="card-subtitle">Use a comment ID from a webhook event to reply directly.</p></div><span className="stat-icon"><Icon name="send" size={15} /></span></div>
        <form className="form-grid" onSubmit={reply}>
          <div className="field"><label className="field-label" htmlFor="comment-account">From account</label><select id="comment-account" value={form.accountId} onChange={(event) => { const account = accounts.find((item) => item.id === event.target.value); setForm({ ...form, accountId: event.target.value, platform: account?.provider === 'facebook_page' ? 'facebook' : 'instagram' }); }} required><option value="">Choose an account</option>{accounts.filter((account) => account.provider !== 'threads').map((account) => <option key={account.id} value={account.id}>{account.name || account.externalId} · {channel(account.provider)}</option>)}</select></div>
          <div className="field"><label className="field-label" htmlFor="comment-id">Comment ID</label><input className="code-input" id="comment-id" placeholder="e.g. 179421…" value={form.commentId} onChange={(event) => setForm({ ...form, commentId: event.target.value })} required /></div>
          <div className="field">
            <label className="field-label" htmlFor="comment-text">Your message <span className="char-count">{form.text.length}/500</span></label>
            <textarea id="comment-text" rows={4} placeholder="Write something thoughtful…" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value.slice(0, 500) })} required />
          </div>
          <label className="check-row"><input type="checkbox" checked={form.dm} onChange={(event) => setForm({ ...form, dm: event.target.checked })} /><span><strong>Send as a private message</strong><small>Sends one private message to the commenter, within 7 days of their comment.</small></span></label>
          <div className="form-actions"><button className="btn" type="submit" disabled={sending || loading || !accounts.length}><Icon name="send" size={15} /> {sending ? 'Sending…' : 'Send reply'}</button>{!accounts.length && !loading && <span className="form-error">Connect an account to reply.</span>}</div>
        </form>
      </section>
      <section className="card data-card" aria-labelledby="activity-title">
        <div className="card-header"><div><h3 className="card-title" id="activity-title">Recent activity <span className="list-count">{events.length}</span></h3><p className="card-subtitle">Incoming comments and replies from your connected channels.</p></div><button className="icon-btn" type="button" onClick={() => load(true)} aria-label="Refresh activity" disabled={refreshing}><Icon name="arrow-right" size={14} className={refreshing ? 'spin' : ''} /></button></div>
        <div className="inbox-toolbar" role="tablist" aria-label="Inbox filter">
          <button className={`toolbar-filter ${tab === 'all' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>All activity</button>
          <button className={`toolbar-filter ${tab === 'needs' ? 'active' : ''}`} type="button" role="tab" aria-selected={tab === 'needs'} onClick={() => setTab('needs')}>Needs reply{needsReply > 0 ? ` · ${needsReply}` : ''}</button>
        </div>
        <div className="inbox-list">
          {loading && <div className="empty-state" aria-busy="true">Loading recent activity…</div>}
          {visible.map((event) => (
            <div className="inbox-item" key={event.id}>
              <div className="comment-avatar" aria-hidden="true">{initials(event.senderId)}</div>
              <div className="inbox-copy">
                <div className="inbox-meta"><strong>{event.senderId || 'Social user'}</strong><time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>{when(event.createdAt)}</time></div>
                <p>{event.text || 'New comment received.'}</p>
                <div className="inbox-foot">
                  <span className={`platform-avatar ${event.platform === 'facebook' ? 'facebook' : 'instagram'}`} style={{ width: 20, height: 20, flexBasis: 20, borderRadius: 6 }} aria-label={event.platform}><Icon name={event.platform === 'facebook' ? 'facebook' : 'instagram'} size={11} /></span>
                  {event.replied ? <span className="replied-label"><Icon name="check" size={12} /> Replied{event.dmSent ? ' · DM sent' : ''}</span> : <span className="status-pill status-pending">Needs reply</span>}
                </div>
              </div>
            </div>
          ))}
          {!loading && visible.length === 0 && <div className="empty-state"><div className="empty-icon"><Icon name="inbox" size={18} /></div><strong>{tab === 'needs' ? 'All caught up' : 'Your inbox is quiet'}</strong>{tab === 'needs' ? 'Every comment has a reply. Nice work.' : 'New comments from connected channels will appear here.'}</div>}
        </div>
      </section>
    </div>
  </div>;
}
