'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/Icons';
import Thumb from '@/components/studio/Thumb';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { NOTE_MAX, NOTE_MIN, approve, decisionError, notifyApprovalsChanged, requestChanges, type ApprovalItem } from '@/lib/approvals';
import { formatName, platformFor, platformName } from '@/lib/format';
import { toLocalInput } from '@/lib/posts';
import { DecisionBadge } from './ApprovalBadge';
import { timeAgo, whenLong } from './time';
import './approvals.css';

/** A sensible new time: the next full hour, at least 15 minutes away. */
function nextSlot() {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

export function ApproveDialog({ item, open, onOpenChange, initialError, onApproved, onStale }: {
  item: ApprovalItem; open: boolean; onOpenChange: (o: boolean) => void; initialError?: string;
  onApproved: (item: ApprovalItem, when: Date) => void; onStale: () => void;
}) {
  const [when, setWhen] = useState(nextSlot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shownError = error || initialError || '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) { setError('Pick a time in the future.'); return; }
    setBusy(true); setError('');
    try {
      await approve(item.id, date.toISOString());
      onApproved(item, date);
    } catch (err) {
      const d = decisionError(err);
      if (d.code === 'NOT_PENDING') { onStale(); onOpenChange(false); } else setError(d.message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="dialog-title">Pick a new time</DialogTitle>
          <DialogDescription>The time this post was planned for has passed. Choose when it should go out.</DialogDescription>
        </DialogHeader>
        <form className="ap-dialog-form" onSubmit={submit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`ap-when-${item.id}`}>Publish on</label>
            <input id={`ap-when-${item.id}`} type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} aria-invalid={!!shownError} aria-describedby={shownError ? `ap-when-err-${item.id}` : undefined} />
            <span className="form-hint">Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
          </div>
          {shownError && <div className="form-error" role="alert" id={`ap-when-err-${item.id}`}>{shownError}</div>}
          <div className="form-actions dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Approving…' : 'Approve at this time'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ChangesDialog({ item, open, onOpenChange, onSent, onStale }: {
  item: ApprovalItem; open: boolean; onOpenChange: (o: boolean) => void; onSent: (item: ApprovalItem) => void; onStale: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = note.trim().length;
  const problem = length < NOTE_MIN ? `Write at least ${NOTE_MIN} characters so the client knows what to change.` : length > NOTE_MAX ? `Keep the note to ${NOTE_MAX} characters or fewer.` : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      await requestChanges(item.id, note.trim());
      onSent(item);
    } catch (err) {
      const d = decisionError(err);
      if (d.code === 'NOT_PENDING') { onStale(); onOpenChange(false); } else setError(d.message);
    } finally { setBusy(false); }
  };

  const shown = error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="dialog-title">Request changes</DialogTitle>
          <DialogDescription>Tell {item.client.name} what to change. They will see your note and can send the post back.</DialogDescription>
        </DialogHeader>
        <form className="ap-dialog-form" onSubmit={submit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`ap-note-${item.id}`}>
              Note <span className={`ap-count ${length > NOTE_MAX ? 'over' : ''}`} aria-live="polite">{length} / {NOTE_MAX}</span>
            </label>
            <textarea id={`ap-note-${item.id}`} value={note} onChange={(e) => { setNote(e.target.value); setError(''); }} rows={4} autoFocus required aria-invalid={!!shown} aria-describedby={shown ? `ap-note-err-${item.id}` : undefined} placeholder="For example: please use the second photo and shorten the caption." />
          </div>
          {shown && <div className="form-error" role="alert" id={`ap-note-err-${item.id}`}>{shown}</div>}
          <div className="form-actions dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send note'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One post waiting for a decision, with Approve and Request changes. Decided items (recent list) pass `decided` and show
 * the outcome instead of the buttons. `onDone` is told when the post left the queue; `onStale` when someone else decided first.
 */
export default function ApprovalCard({ item, showClient = true, decided = false, onDone, onStale }: {
  item: ApprovalItem; showClient?: boolean; decided?: boolean; onDone?: (item: ApprovalItem) => void; onStale?: () => void;
}) {
  const [dialog, setDialog] = useState<'' | 'approve' | 'changes'>('');
  const [late, setLate] = useState('');
  const [busy, setBusy] = useState(false);
  const platform = platformFor(item.account?.provider || item.platform);
  const label = item.caption || `${formatName(item.mediaType)} post`;

  const stale = () => { toast('Already decided', { description: 'Someone else handled this post. The list is up to date.' }); onStale?.(); };
  const finished = () => { notifyApprovalsChanged(); onDone?.(item); };

  const approveNow = async () => {
    if (item.pastDue) { setLate(''); setDialog('approve'); return; }
    setBusy(true);
    try {
      await approve(item.id);
      toast.success('Approved', { description: `It goes out ${whenLong(item.scheduledAt)}.` });
      finished();
    } catch (err) {
      const d = decisionError(err);
      if (d.code === 'NOT_PENDING') stale();
      else if (d.code === 'SCHEDULE_TIME_PASSED') { setLate(d.message); setDialog('approve'); }
      else toast.error(d.message);
    } finally { setBusy(false); }
  };

  return (
    <li className={`card ap-card ${decided ? 'ap-compact' : ''}`} aria-label={label.slice(0, 80)}>
      <Thumb id={item.id} media={item.mediaUrls} mediaType={item.mediaType} caption={null} ratio="4 / 5" />
      <div className="ap-body">
        {item.caption ? <p className="ap-caption">{item.caption}</p> : <p className="ap-caption ap-empty">No caption ({formatName(item.mediaType)})</p>}
        <div className="ap-chips">
          <span className="st-chip"><Icon name={platform} size={11} /> {platformName(platform)}{item.account?.name ? ` · ${item.account.name}` : ''}</span>
          <span className="st-chip">{formatName(item.mediaType)}</span>
          {decided && <DecisionBadge status={item.approvalStatus} />}
          {!decided && item.pastDue && <span className="ap-pill ap-late">Time has passed</span>}
        </div>
        <dl className="ap-meta">
          {showClient && <div><dt>Client</dt><dd><Link className="ap-client" href={`/admin/clients/${item.client.id}`}>{item.client.name}</Link></dd></div>}
          <div><dt>{decided ? 'Was planned for' : 'Goes out'}</dt><dd>{whenLong(item.scheduledAt)}</dd></div>
          <div><dt>Submitted</dt><dd>{item.submittedBy ? `by ${item.submittedBy.email}, ` : ''}<time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time></dd></div>
          {decided && item.approvalDecidedAt && <div><dt>Decided</dt><dd><time dateTime={item.approvalDecidedAt}>{timeAgo(item.approvalDecidedAt)}</time></dd></div>}
        </dl>
        {item.approvalNote && (
          <blockquote className="ap-quote"><b>{decided ? 'Note' : 'Earlier note'}</b>{item.approvalNote}</blockquote>
        )}
        {!decided && (
          <div className="ap-actions">
            <button className="btn btn-sm" type="button" onClick={approveNow} disabled={busy}><Icon name="check" size={14} /> {item.pastDue ? 'Approve with a new time' : 'Approve'}</button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => setDialog('changes')} disabled={busy}>Request changes</button>
          </div>
        )}
      </div>
      {dialog === 'approve' && (
        <ApproveDialog item={item} open initialError={late} onOpenChange={(o) => !o && setDialog('')} onStale={stale}
          onApproved={(_, when) => { setDialog(''); toast.success('Approved', { description: `It goes out ${whenLong(when)}.` }); finished(); }} />
      )}
      {dialog === 'changes' && (
        <ChangesDialog item={item} open onOpenChange={(o) => !o && setDialog('')} onStale={stale}
          onSent={() => { setDialog(''); toast.success('Changes requested', { description: `${item.client.name} will see your note.` }); finished(); }} />
      )}
    </li>
  );
}
