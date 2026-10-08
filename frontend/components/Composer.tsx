'use client';

import { Select } from '@/components/ui/select';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from './Icons';
import { API, api, authHeaders } from '../lib/api';
import { isStaff, useCan, useMe } from '../lib/session';
import { isVideoUrl, mediaSrc, parseMedia } from '../lib/media';
import { toLocalInput, type Draft } from '../lib/posts';
import { FORMATS_BY_PLATFORM, errorText, formatName, platformFor, platformName, type Platform } from '../lib/format';
import PhonePreview from './studio/PhonePreview';
import { NOT_ON } from './FeatureGate';
import { canManageChannels } from '../lib/nav';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type CheckRow = { id: string; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; mediaUrls: string[]; verdict?: string | null; hook?: { rating: string; score: number } | null; createdAt: string };

type SuggestedHook = { id: string; text: string; category: string; isFavorite: boolean; usedCount: number };

type ComposerAccount = { id: string; provider: string; externalId: string; name?: string | null };

const CAPTION_LIMIT = { instagram: 2200, facebook: 63206, threads: 500 } as const;

function defaultTime(day?: string | null) {
  if (day) {
    const d = new Date(`${day}T09:00`);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) return toLocalInput(d);
  }
  // Next full hour, at least 15 minutes out.
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

/** An attached photo. When the file cannot be loaded, say so instead of leaving an empty tile. */
function AttachImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="attach-video">Preview unavailable</span>;
  return <img src={mediaSrc(url)} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

const whenFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Composer({ open, onOpenChange, accounts, accountsLoading, initialCaption, initialDay, initialIdeaId, draft, onDraftChange, onScheduled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ComposerAccount[];
  accountsLoading: boolean;
  initialCaption?: string;
  initialDay?: string | null;
  /** The content idea this post is written from, so the post can point back at it. */
  initialIdeaId?: string;
  /** A saved draft to continue; its fields replace whatever is in the editor. */
  draft?: Draft | null;
  /** Called after a draft is saved, deleted or turned into a post, so lists can refresh. */
  onDraftChange?: () => void;
  onScheduled?: () => void;
}) {
  // What this person may do. Unknown (outside the app shell) hides nothing; the server enforces every switch.
  const me = useMe();
  const canCompose = useCan('compose');
  const canSchedule = useCan('schedule');
  const canCheck = useCan('preflight');
  const canConnect = !me || canManageChannels(me);
  // Clients whose posts need approval submit them instead of scheduling. Staff are never held.
  const needsApproval = !!me?.client?.requireApproval && !isStaff(me);
  const [accountId, setAccountId] = useState('');
  const [mediaType, setMediaType] = useState('IMAGE');
  const [caption, setCaption] = useState('');
  const [mediaUrls, setMediaUrls] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewOn, setPreviewOn] = useState<'' | Platform>('');
  const [hooks, setHooks] = useState<SuggestedHook[]>([]);
  const [checks, setChecks] = useState<CheckRow[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  // The draft being written. Each editing session gets its own slot, so a save still queued when the editor is reset
  // finishes against the draft it was started for instead of leaking its id into the next, blank session.
  const slot = useRef<{ id: string | null }>({ id: null });
  const inflight = useRef<Promise<unknown> | null>(null);
  const loadedDraft = useRef<string | null>(null);

  // Prefill each time the composer opens (ideas, hooks and the planner hand text or a day over).
  useEffect(() => {
    if (!open) return;
    setError('');
    if (initialCaption) setCaption(initialCaption);
    setScheduledAt(defaultTime(initialDay));
  }, [open, initialCaption, initialDay]);

  // Opening lines from your own library, favourites first, to start a caption from.
  useEffect(() => {
    if (!open) return;
    api<SuggestedHook[]>('/hooks').then((list) => setHooks((list || []).sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.usedCount - a.usedCount).slice(0, 3))).catch(() => setHooks([]));
  }, [open]);

  // Continue a saved draft: its fields replace the editor's, once per draft.
  useEffect(() => {
    if (!open || !draft || loadedDraft.current === draft.id) return;
    loadedDraft.current = draft.id;
    slot.current = { id: draft.id }; setDraftId(draft.id);
    setCaption(draft.caption || '');
    setMediaUrls(parseMedia(draft.mediaUrls).join('\n'));
    setMediaType(draft.mediaType || 'IMAGE');
    if (draft.accountId) setAccountId(draft.accountId);
    if (draft.scheduledAt && new Date(draft.scheduledAt).getTime() > Date.now()) setScheduledAt(toLocalInput(new Date(draft.scheduledAt)));
    setSaveState('saved');
  }, [open, draft]);

  // Existing pre-flight checks, so the score for this media can show up right here.
  useEffect(() => {
    if (!open) return;
    api<CheckRow[]>('/preflight').then((rows) => setChecks(rows || [])).catch(() => setChecks([]));
  }, [open]);

  // One connected account: pick it for the user.
  useEffect(() => {
    if (!accountId && accounts.length === 1) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const account = accounts.find((a) => a.id === accountId);
  const platform = platformFor(account?.provider);
  const formats = FORMATS_BY_PLATFORM[platform];
  const limit = CAPTION_LIMIT[platform];
  const mediaList = useMemo(() => mediaUrls.split('\n').map((u) => u.trim()).filter(Boolean), [mediaUrls]);

  // Autosave: shortly after typing stops, keep what is there as a draft. Empty editors are never saved.
  const hasContent = caption.trim().length > 0 || mediaList.length > 0;

  /**
   * Saves the editor as a draft. Saves run one after another, so a second save can never start before the first has
   * stored its id and create a duplicate draft. The payload and the slot are taken now, so the editor may be reset
   * right after calling this.
   */
  const saveDraft = () => {
    const mine = slot.current;
    const current = () => slot.current === mine; // false once the editor has moved on to another session
    const payload = { accountId: accountId || null, platform: account ? platform : null, mediaType, caption, mediaUrls: mediaList, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null, ideaId: initialIdeaId || null };
    setSaveState('saving');
    const run = async () => {
      try {
        if (mine.id) await api(`/drafts/${mine.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        else { const created = await api<Draft>('/drafts', { method: 'POST', body: JSON.stringify(payload) }); mine.id = created.id; if (current()) setDraftId(created.id); }
        if (current()) setSaveState('saved');
        onDraftChange?.();
      } catch { if (current()) setSaveState('error'); }
    };
    inflight.current = (inflight.current ?? Promise.resolve()).then(run);
    return inflight.current;
  };
  useEffect(() => {
    if (!open || saving || !hasContent) return;
    const timer = window.setTimeout(() => { void saveDraft(); }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving, hasContent, caption, mediaUrls, mediaType, accountId, scheduledAt]);

  /** Back to a blank editor, so the next time the composer opens it starts fresh (a saved draft is reopened from the list). */
  const resetEditor = () => {
    setCaption(''); setMediaUrls(''); setMediaType('IMAGE'); setError(''); setPreviewOn('');
    setSaveState(''); setDraftId(null); slot.current = { id: null }; loadedDraft.current = null;
  };

  /** Every way out of the composer: whatever was typed is saved first, then the editor clears. */
  const closeComposer = () => {
    if (hasContent && !saving) { void saveDraft(); toast('Saved to your drafts'); }
    resetEditor();
    onOpenChange(false);
  };

  const discardDraft = async () => {
    const mine = slot.current;
    resetEditor();
    try {
      await inflight.current; // a save that is mid-flight may be the one that creates the draft
      if (mine.id) { await api(`/drafts/${mine.id}`, { method: 'DELETE' }); onDraftChange?.(); toast('Draft discarded'); }
    } catch { /* it will be listed again next load */ }
    onOpenChange(false);
  };

  // A check belongs to this post when it covers the same uploaded file (compared by path, not host).
  const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
  const mine = useMemo(() => {
    const paths = new Set(mediaList.map(pathOf));
    return checks.filter((c) => c.mediaUrls?.some((u) => paths.has(pathOf(u)))).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] || null;
  }, [checks, mediaList]);

  const shownPlatform: Platform = previewOn || platform;
  const startWith = (text: string) => setCaption((c) => (c.trim() ? `${text}\n\n${c}` : text));

  useEffect(() => {
    if (!formats.includes(mediaType)) setMediaType(formats[0]);
  }, [formats, mediaType]);

  const needsMedia = mediaType !== 'TEXT';
  const blocker = !canSchedule
    ? `${NOT_ON}. You can still save drafts.`
    : !accounts.length
    ? 'Connect a channel first.'
    : !account
      ? null
      : needsMedia && !mediaList.length
        ? `${formatName(mediaType)} posts need a photo or video.`
        : caption.length > limit
          ? `${platformName(platform)} captions are limited to ${limit.toLocaleString()} characters.`
          : null;

  const attachFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setError('');
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
      setMediaUrls([...mediaList, ...urls].join('\n'));
      if (kind === 'VIDEO' && mediaType === 'IMAGE') setMediaType(platform === 'instagram' ? 'REELS' : 'VIDEO');
    } catch (e) {
      setError(errorText(e, 'Could not upload that file.'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeMedia = (url: string) => setMediaUrls(mediaList.filter((u) => u !== url).join('\n'));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocker) return;
    setError('');
    setSaving(true);
    try {
      await inflight.current; // let a save that is mid-flight finish, so its draft id is known and gets cleaned up
      const when = new Date(scheduledAt);
      const saved = await api<{ status?: string } | null>('/posts', { method: 'POST', body: JSON.stringify({ accountId, platform, mediaType, caption, mediaUrls: mediaList, scheduledAt: when.toISOString(), ideaId: initialIdeaId || undefined, draftId: slot.current.id || undefined }) });
      resetEditor();
      onOpenChange(false);
      if (saved?.status === 'PENDING_APPROVAL' || (needsApproval && saved?.status !== 'SCHEDULED')) {
        toast.success('Sent for approval. Your account manager will review it.', { description: `${platformName(platform)} · ${formatName(mediaType)} · planned for ${whenFormat.format(when)}` });
      } else {
        toast.success(`Scheduled for ${whenFormat.format(when)}`, { description: `${platformName(platform)} · ${formatName(mediaType)}` });
      }
      onScheduled?.();
      onDraftChange?.();
    } catch (e) {
      setError(errorText(e, needsApproval ? 'Could not submit this post.' : 'Could not schedule this post.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) onOpenChange(true); else closeComposer(); }}>
      <DialogContent className="composer-dialog max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle className="dialog-title">Create a post</DialogTitle>
          <DialogDescription>Write your post and see how it will look on each platform.</DialogDescription>
        </DialogHeader>

        {!canCompose ? (
          <div className="empty-state" style={{ margin: 0 }}>
            <strong>Creating posts is not switched on for your account</strong>
            Ask your account manager if you need it.
          </div>
        ) : !accountsLoading && !accounts.length ? (
          <div className="empty-state" style={{ margin: 0 }}>
            <div className="empty-icon"><Icon name="link" size={18} /></div>
            <strong>{canConnect ? 'Connect a channel to start scheduling' : 'No channels are connected yet'}</strong>
            Motion publishes to Instagram, Facebook and Threads.
            <br />{canConnect ? <Link className="btn btn-sm" href="/connect" onClick={() => closeComposer()} style={{ marginTop: 12 }}>Connect a channel</Link> : 'Your account manager connects them for you.'}
          </div>
        ) : (
          <div className="cs-grid">
          <form className="form-grid" onSubmit={submit} noValidate={false}>
            <div className="form-row">
              <div className="field">
                <label className="field-label" htmlFor="account">Publish to</label>
                <Select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">Choose a channel</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId} · {platformName(a.provider)}</option>)}
                </Select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mediaType">Format</label>
                <Select id="mediaType" value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
                  {formats.map((type) => <option key={type} value={type}>{formatName(type)}</option>)}
                </Select>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="caption">
                Caption <span className={`char-count ${caption.length > limit ? 'over' : ''}`} aria-live="polite">{caption.length.toLocaleString()} / {limit.toLocaleString()}</span>
              </label>
              <textarea id="caption" placeholder="Tell your story…" value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} autoFocus aria-invalid={caption.length > limit} />
              {caption.trim().length < 12 && hooks.length > 0 && (
                <div className="cs-hooks" aria-label="Start with one of your hooks">
                  <span className="cs-hooks-l"><span className="st-ai" aria-hidden="true">AI</span> Start with a hook</span>
                  {hooks.map((h) => <button key={h.id} type="button" className="cs-hook" onClick={() => startWith(h.text)}>{h.text}</button>)}
                </div>
              )}
            </div>

            <div className="field">
              <span className="field-label" id="media-label">Media {needsMedia ? '' : <span className="muted">(optional)</span>}</span>
              <div className="form-actions" style={{ marginTop: 0 }}>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => attachFiles(e.target.files)} />
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRef.current?.click()} disabled={uploading} aria-describedby="media-hint">
                  <Icon name="plus" size={14} /> {uploading ? 'Uploading…' : 'Add photos or video'}
                </button>
                <span className="form-hint" id="media-hint">JPG, PNG, WebP, GIF or MP4, up to 100 MB</span>
              </div>
              {mediaList.length > 0 && (
                <ul className="attach-grid" aria-label="Attached media">
                  {mediaList.map((url, i) => (
                    <li className="attach-item" key={url}>
                      {isVideoUrl(url)
                        ? <span className="attach-video"><Icon name="play" size={16} /> Video</span>
                        : <AttachImage url={url} alt={`Attachment ${i + 1}`} />}
                      <button className="attach-remove" type="button" onClick={() => removeMedia(url)} aria-label={`Remove attachment ${i + 1}`}><Icon name="x" size={12} /></button>
                    </li>
                  ))}
                </ul>
              )}
              <details className="inline-details">
                <summary>Paste media links instead</summary>
                <textarea id="mediaUrls" aria-label="Media links, one per line" placeholder="One public https link per line" value={mediaUrls} onChange={(e) => setMediaUrls(e.target.value)} rows={2} />
              </details>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="scheduledAt">{needsApproval ? 'Planned for' : 'Publish on'}</label>
              <input id="scheduledAt" type="datetime-local" value={scheduledAt} min={toLocalInput(new Date())} onChange={(e) => setScheduledAt(e.target.value)} required aria-describedby="tz-hint" />
              <span className="form-hint" id="tz-hint">Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}

            <div className="form-actions dialog-actions">
              {blocker ? <span className="form-hint dialog-blocker" id="schedule-blocker">{blocker}</span> : saveState ? <span className="form-hint dialog-blocker cs-saved" role="status">{saveState === 'saving' ? 'Saving draft…' : saveState === 'saved' ? 'Draft saved' : 'Could not save the draft'}</span> : null}
              {draftId && <button className="btn btn-ghost" type="button" onClick={discardDraft}><Icon name="trash" size={14} /> Discard</button>}
              <button className="btn btn-ghost" type="button" onClick={closeComposer}>{draftId ? 'Save and close' : 'Cancel'}</button>
              {canCheck && <Link className="btn btn-ghost" href={`/preflight?${new URLSearchParams([...mediaList.filter((u) => u.includes('/media/')).map((u) => ['media', u]), ['caption', caption], ['platform', platform]]).toString()}`} onClick={closeComposer}>
                <Icon name="gauge" size={15} /> Check before posting
              </Link>}
              <button className="btn" type="submit" disabled={saving || uploading || !!blocker} aria-describedby={blocker ? 'schedule-blocker' : undefined}>
                <Icon name="calendar" size={15} /> {needsApproval ? (saving ? 'Submitting…' : 'Submit for approval') : (saving ? 'Scheduling…' : 'Schedule post')}
              </button>
            </div>
          </form>
          <aside className="cs-preview" aria-label="Post preview">
            <div className="cs-preview-tabs" role="tablist" aria-label="Preview platform">
              {(['instagram', 'facebook', 'threads'] as Platform[]).map((pl) => (
                <button key={pl} type="button" role="tab" aria-selected={shownPlatform === pl} className={`toolbar-filter ${shownPlatform === pl ? 'active' : ''}`} onClick={() => setPreviewOn(pl)}>{platformName(pl)}</button>
              ))}
            </div>
            <PhonePreview platform={shownPlatform} name={account?.name || platformName(shownPlatform)} caption={caption} media={mediaList} mediaType={mediaType} id="composer" />
            {mine && (
              <Link className="cs-check" href={`/preflight/${mine.id}`} onClick={closeComposer}>
                {mine.status === 'DONE' && mine.hook ? <span className="cs-check-num" data-rating={mine.hook.rating.toLowerCase()}>{Math.round(mine.hook.score)}</span> : <span className="cs-check-num"><Icon name="gauge" size={15} /></span>}
                <span className="cs-check-copy">
                  <b>{mine.status === 'DONE' ? `Pre-flight: hook ${mine.hook?.rating ? mine.hook.rating.toLowerCase() : 'checked'}` : mine.status === 'FAILED' ? 'Pre-flight check failed' : 'Pre-flight check running'}</b>
                  <span>{mine.status === 'DONE' ? (mine.verdict || 'Open the full check.') : mine.status === 'FAILED' ? 'Open it to retry.' : 'You will be told when it finishes.'}</span>
                </span>
                <Icon name="arrow-right" size={14} />
              </Link>
            )}
            <p className="cs-note">
              {shownPlatform === 'threads' ? 'Threads shows up to 500 characters.' : shownPlatform === 'instagram' ? 'Instagram cuts the caption after about 125 characters, behind “more”.' : 'Facebook shows the first few lines, then “See more”.'}
              {previewOn && previewOn !== platform && account ? ` You are publishing to ${platformName(platform)}.` : ''}
            </p>
          </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
