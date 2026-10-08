'use client';

import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/Icons';
import { approvalView, resubmit } from '@/lib/approvals';
import { api } from '@/lib/api';
import { errorText } from '@/lib/format';
import { toLocalInput, type Post } from '@/lib/posts';
import { isStaff, useMe } from '@/lib/session';
import './approvals.css';

/**
 * What the post drawer says about approval: where the post stands, the staff note, and for a post that came back with
 * changes requested, "Edit and resubmit" and a plain "Resubmit". Renders nothing for posts that never needed approval.
 */
export default function ApprovalPanel({ post, onChanged, onClose }: { post: Post; onChanged: () => void; onClose: () => void }) {
  const me = useMe();
  const view = approvalView(post);
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(post.caption || '');
  const [when, setWhen] = useState(toLocalInput(new Date(post.scheduledAt)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setEditing(false); setError(''); setCaption(post.caption || ''); setWhen(toLocalInput(new Date(post.scheduledAt))); }, [post.id, post.caption, post.scheduledAt]);

  if (!view) return null;
  const mine = !isStaff(me); // staff decide in the queue

  const sendAgain = async () => {
    setBusy(true);
    try { await resubmit(post.id); toast.success('Sent for approval again', { description: 'Your account manager will review it.' }); onChanged(); onClose(); }
    catch (e) { toast.error(errorText(e, 'Could not resubmit this post.')); }
    finally { setBusy(false); }
  };

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) { setError('Pick a time in the future.'); return; }
    setBusy(true); setError('');
    try {
      await api(`/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ caption, scheduledAt: date.toISOString() }) });
      toast.success('Sent for approval again', { description: 'Your account manager will review your changes.' });
      onChanged(); onClose();
    } catch (err) { setError(errorText(err, 'Could not save your changes.')); }
    finally { setBusy(false); }
  };

  return (
    <div className={`ap-banner ap-${view}`}>
      {view === 'awaiting' && <p>Your account manager is reviewing this post. It will be scheduled once it is approved.</p>}
      {view === 'approved' && <p>Approved and scheduled. If you change it, it goes back for approval.</p>}
      {view === 'changes' && (
        <>
          {post.approvalNote && <blockquote className="ap-quote"><b>Your account manager says</b>{post.approvalNote}</blockquote>}
          {!post.approvalNote && <p>Your account manager asked for changes.</p>}
          {mine && !editing && (
            <div className="ap-actions">
              <button className="btn btn-sm" type="button" onClick={() => setEditing(true)} disabled={busy}><Icon name="check" size={14} /> Edit and resubmit</button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={sendAgain} disabled={busy}>{busy ? 'Sending…' : 'Resubmit'}</button>
            </div>
          )}
          {mine && editing && (
            <form className="ap-edit" onSubmit={saveEdit} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="ap-edit-caption">Caption</label>
                <textarea id="ap-edit-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ap-edit-when">Publish on</label>
                <input id="ap-edit-when" type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
              </div>
              {error && <div className="form-error" role="alert">{error}</div>}
              <div className="ap-actions">
                <button className="btn btn-sm" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Save and resubmit'}</button>
                <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
