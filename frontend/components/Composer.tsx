'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from './Icons';
import { API, api, authHeaders } from '../lib/api';
import { FORMATS_BY_PLATFORM, errorText, formatName, platformFor, platformName } from '../lib/format';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type ComposerAccount = { id: string; provider: string; externalId: string; name?: string | null };

const CAPTION_LIMIT = { instagram: 2200, facebook: 63206, threads: 500 } as const;

/** A datetime-local value in the user's own timezone. */
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultTime(day?: string | null) {
  if (day) {
    const d = new Date(`${day}T09:00`);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) return localInput(d);
  }
  // Next full hour, at least 15 minutes out.
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return localInput(d);
}

const whenFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function Composer({ open, onOpenChange, accounts, accountsLoading, initialCaption, initialDay, onScheduled }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ComposerAccount[];
  accountsLoading: boolean;
  initialCaption?: string;
  initialDay?: string | null;
  onScheduled?: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [mediaType, setMediaType] = useState('IMAGE');
  const [caption, setCaption] = useState('');
  const [mediaUrls, setMediaUrls] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill each time the composer opens (ideas, hooks and the planner hand text or a day over).
  useEffect(() => {
    if (!open) return;
    setError('');
    if (initialCaption) setCaption(initialCaption);
    setScheduledAt(defaultTime(initialDay));
  }, [open, initialCaption, initialDay]);

  // One connected account: pick it for the user.
  useEffect(() => {
    if (!accountId && accounts.length === 1) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const account = accounts.find((a) => a.id === accountId);
  const platform = platformFor(account?.provider);
  const formats = FORMATS_BY_PLATFORM[platform];
  const limit = CAPTION_LIMIT[platform];
  const mediaList = useMemo(() => mediaUrls.split('\n').map((u) => u.trim()).filter(Boolean), [mediaUrls]);

  useEffect(() => {
    if (!formats.includes(mediaType)) setMediaType(formats[0]);
  }, [formats, mediaType]);

  const needsMedia = mediaType !== 'TEXT';
  const blocker = !accounts.length
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
      const when = new Date(scheduledAt);
      await api('/posts', { method: 'POST', body: JSON.stringify({ accountId, platform, mediaType, caption, mediaUrls: mediaList, scheduledAt: when.toISOString() }) });
      setCaption('');
      setMediaUrls('');
      onOpenChange(false);
      toast.success(`Scheduled for ${whenFormat.format(when)}`, { description: `${platformName(platform)} · ${formatName(mediaType)}` });
      onScheduled?.();
    } catch (e) {
      setError(errorText(e, 'Could not schedule this post.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="composer-dialog max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="dialog-title">Create a post</DialogTitle>
          <DialogDescription>Pick a channel, add your caption and media, then choose when it goes out.</DialogDescription>
        </DialogHeader>

        {!accountsLoading && !accounts.length ? (
          <div className="empty-state" style={{ margin: 0 }}>
            <div className="empty-icon"><Icon name="link" size={18} /></div>
            <strong>Connect a channel to start scheduling</strong>
            Motion publishes to Instagram, Facebook and Threads.
            <br /><Link className="btn btn-sm" href="/connect" onClick={() => onOpenChange(false)} style={{ marginTop: 12 }}>Connect a channel</Link>
          </div>
        ) : (
          <form className="form-grid" onSubmit={submit} noValidate={false}>
            <div className="form-row">
              <div className="field">
                <label className="field-label" htmlFor="account">Publish to</label>
                <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="">Choose a channel</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId} · {platformName(a.provider)}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="mediaType">Format</label>
                <select id="mediaType" value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
                  {formats.map((type) => <option key={type} value={type}>{formatName(type)}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="caption">
                Caption <span className={`char-count ${caption.length > limit ? 'over' : ''}`} aria-live="polite">{caption.length.toLocaleString()} / {limit.toLocaleString()}</span>
              </label>
              <textarea id="caption" placeholder="Tell your story…" value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} autoFocus aria-invalid={caption.length > limit} />
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
                      {url.match(/\.(mp4|mov)(\?|$)/i)
                        ? <span className="attach-video"><Icon name="play" size={16} /> Video</span>
                        : <img src={url} alt={`Attachment ${i + 1}`} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
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
              <label className="field-label" htmlFor="scheduledAt">Publish on</label>
              <input id="scheduledAt" type="datetime-local" value={scheduledAt} min={localInput(new Date())} onChange={(e) => setScheduledAt(e.target.value)} required aria-describedby="tz-hint" />
              <span className="form-hint" id="tz-hint">Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</span>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}

            <div className="form-actions dialog-actions">
              {blocker && <span className="form-hint dialog-blocker" id="schedule-blocker">{blocker}</span>}
              <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</button>
              <Link className="btn btn-ghost" href={`/preflight?${new URLSearchParams([...mediaList.filter((u) => u.includes('/media/')).map((u) => ['media', u]), ['caption', caption], ['platform', platform]]).toString()}`} onClick={() => onOpenChange(false)}>
                <Icon name="gauge" size={15} /> Check before posting
              </Link>
              <button className="btn" type="submit" disabled={saving || uploading || !!blocker} aria-describedby={blocker ? 'schedule-blocker' : undefined}>
                <Icon name="calendar" size={15} /> {saving ? 'Scheduling…' : 'Schedule post'}
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
