'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Icon } from '../Icons';
import PhonePreview from './PhonePreview';
import { api } from '@/lib/api';
import { errorText, formatName, platformName, statusName } from '@/lib/format';
import { postPlatform, reschedule, toLocalInput, type Post } from '@/lib/posts';

/** Slide-over detail for one post: how it looks, when it goes out, and the two things you can do to it. */
export default function PostDrawer({ post, onOpenChange, onChanged }: { post: Post | null; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setConfirming(false); if (post) setWhen(toLocalInput(new Date(post.scheduledAt))); }, [post]);

  const platform = post ? postPlatform(post) : 'instagram';
  const editable = post?.status === 'SCHEDULED';

  const move = async () => {
    if (!post) return;
    const date = new Date(when);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) { toast.error('Pick a time in the future.'); return; }
    setBusy(true);
    try { await reschedule(post, date); toast.success('Rescheduled', { description: `Now goes out ${date.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` }); onChanged(); onOpenChange(false); }
    catch (e) { toast.error(errorText(e, 'Could not reschedule this post.')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!post) return;
    setBusy(true);
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); toast.success('Post removed'); onChanged(); onOpenChange(false); }
    catch (e) { toast.error(errorText(e, 'Could not remove this post.')); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={!!post} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="st-drawer w-full sm:max-w-[440px] gap-0 p-0">
        {post && (
          <>
            <div className="st-drawer-head">
              <SheetTitle>{post.caption ? post.caption.slice(0, 60) : `${formatName(post.mediaType)} post`}</SheetTitle>
              <SheetDescription>{platformName(platform)}{post.account?.name ? ` · ${post.account.name}` : ''}</SheetDescription>
              <div className="st-drawer-meta">
                <span className={`status-pill status-${post.status.toLowerCase()}`}>{statusName(post.status)}</span>
                <span className="muted">{new Date(post.scheduledAt).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            </div>
            <div className="st-drawer-body">
              {post.idea && <Link className="st-chip" href="/lab" onClick={() => onOpenChange(false)}><Icon name="bulb" size={12} /> From idea: {post.idea.title}</Link>}
              <PhonePreview platform={platform} name={post.account?.name || platformName(platform)} caption={post.caption} media={post.mediaUrls} mediaType={post.mediaType} id={post.id} />
              {post.error && <div className="notice notice-error" role="alert"><Icon name="alert" size={15} /> {post.error}</div>}
              {editable && (
                <div className="field">
                  <label className="field-label" htmlFor="drawer-when">Publish time</label>
                  <div className="st-row">
                    <input id="drawer-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    <button className="btn" type="button" onClick={move} disabled={busy}>Move</button>
                  </div>
                </div>
              )}
            </div>
            <div className="st-drawer-foot">
              {post.permalink && <a className="btn btn-ghost" href={post.permalink} target="_blank" rel="noreferrer">Open post <Icon name="external" size={14} /></a>}
              {editable && (confirming
                ? <><span className="muted">Remove this post?</span><button className="btn btn-danger" type="button" onClick={remove} disabled={busy}>Yes, remove</button><button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>Keep</button></>
                : <button className="btn btn-ghost" type="button" onClick={() => setConfirming(true)}><Icon name="trash" size={14} /> Remove</button>)}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
