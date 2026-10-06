'use client';

import { Select } from '@/components/ui/select';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Icon } from '../Icons';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { api } from '../../lib/api';
import { mediaSrc } from '../../lib/media';
import { failToast, isVideo, PLATFORMS, uploadFiles } from './shared';

type Draft = { mediaUrls: string[]; text: string };
export type Prefill = { mediaUrls: string[]; caption: string; platform: string };

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime';
const emptyDraft = (): Draft => ({ mediaUrls: [], text: '' });

/** Upload a reel (or image / text post), queue the check, and hand back to the list, which shows its progress. */
export function NewCheckDialog({ open, onOpenChange, onQueued, aiReady, prefill }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQueued: () => void;
  aiReady: boolean;
  prefill?: Prefill | null;
}) {
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [platform, setPlatform] = useState('instagram');
  const [caption, setCaption] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [uploading, setUploading] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!prefill) return;
    setMode('single');
    setDrafts([{ mediaUrls: prefill.mediaUrls, text: '' }]);
    setCaption(prefill.caption);
    setPlatform(prefill.platform);
  }, [prefill]);

  const reset = () => { setMode('single'); setCaption(''); setDrafts([emptyDraft()]); };

  const switchMode = (next: 'single' | 'compare') => {
    setMode(next);
    setDrafts((d) => next === 'compare' ? [d[0] || emptyDraft(), d[1] || emptyDraft()] : [d[0] || emptyDraft()]);
  };

  const attach = async (index: number, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(index);
    try {
      const urls = await uploadFiles(files);
      setDrafts((all) => all.map((d, i) => i === index ? { ...d, mediaUrls: urls.some(isVideo) ? urls.slice(0, 1) : [...d.mediaUrls.filter((u) => !isVideo(u)), ...urls].slice(0, 10) } : d));
    } catch (error) { failToast(error, 'Could not upload that file.'); }
    finally { setUploading(null); const input = fileRefs.current[index]; if (input) input.value = ''; }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true);
    try {
      if (mode === 'single') await api('/preflight', { method: 'POST', body: JSON.stringify({ platform, caption, mediaUrls: drafts[0].mediaUrls, text: drafts[0].text }) });
      else await api('/preflight/compare', { method: 'POST', body: JSON.stringify({ platform, caption, variants: drafts }) });
      const reel = drafts.some((d) => d.mediaUrls.some(isVideo));
      toast.success(mode === 'compare' ? 'Versions queued for checking' : 'Check queued', { description: reel ? 'Reels take about 10–15 minutes. It shows Completed in the list when ready.' : 'Usually ready in under a minute.' });
      reset();
      onOpenChange(false);
      onQueued();
    } catch (error) { failToast(error, 'Could not start the check.'); }
    finally { setSubmitting(false); }
  };

  const ready = drafts.every((d) => d.mediaUrls.length || d.text.trim()) || (mode === 'single' && caption.trim());

  return <Dialog open={open} onOpenChange={(next) => { if (!submitting && uploading === null) onOpenChange(next); }}>
    <DialogContent className="pf-dialog sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>New reel check</DialogTitle>
        <DialogDescription>Upload a reel and get predicted attention, a brain view and fixes. Images, carousels and text posts get a full review too.</DialogDescription>
      </DialogHeader>
      <form className="form-grid" onSubmit={submit}>
        <div className="tag-row" role="tablist" aria-label="Check mode">
          <button type="button" role="tab" aria-selected={mode === 'single'} className={`toolbar-filter ${mode === 'single' ? 'active' : ''}`} onClick={() => switchMode('single')}>One post</button>
          <button type="button" role="tab" aria-selected={mode === 'compare'} className={`toolbar-filter ${mode === 'compare' ? 'active' : ''}`} onClick={() => switchMode('compare')}>Compare versions</button>
        </div>
        <div className="field"><label className="field-label" htmlFor="pf-platform">Posting to</label><Select id="pf-platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>{PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></div>

        {drafts.map((draft, i) => {
          const video = draft.mediaUrls.some(isVideo);
          return <fieldset className="field plain-fieldset pf-draft" key={i}>
            {mode === 'compare' && <legend className="field-label">Version {String.fromCharCode(65 + i)}</legend>}
            <input ref={(el) => { fileRefs.current[i] = el; }} type="file" accept={ACCEPT} multiple className="sr-only" aria-label={`Upload media${mode === 'compare' ? ` for version ${String.fromCharCode(65 + i)}` : ''}`} onChange={(e) => attach(i, e.target.files)} />
            {draft.mediaUrls.length > 0 ? <div className="attach-grid" aria-label="Attached media">
              {draft.mediaUrls.map((url) => <div className="attach-item" key={url}>
                {isVideo(url) ? <span className="attach-video"><Icon name="play" size={16} /> Video</span> : <img src={mediaSrc(url)} alt="Upload preview" loading="lazy" />}
                <button className="attach-remove" type="button" onClick={() => setDrafts((all) => all.map((d, j) => j === i ? { ...d, mediaUrls: d.mediaUrls.filter((u) => u !== url) } : d))} aria-label="Remove file">×</button>
              </div>)}
            </div> : <button className="pf-drop" type="button" onClick={() => fileRefs.current[i]?.click()} disabled={uploading !== null}>
              <Icon name="plus" size={16} /> {uploading === i ? 'Uploading…' : 'Upload a reel, image or carousel'}
              <small>MP4, MOV, JPG, PNG, WebP or GIF · up to 100 MB</small>
            </button>}
            {draft.mediaUrls.length > 0 && !video && draft.mediaUrls.length < 10 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRefs.current[i]?.click()} disabled={uploading !== null}><Icon name="plus" size={13} /> Add slide</button>}
            <label className="field-label" htmlFor={`pf-text-${i}`}>{draft.mediaUrls.length ? (video ? 'Voiceover or on-screen text (optional)' : 'Text on the image (optional)') : 'Or paste a text post'}</label>
            <textarea id={`pf-text-${i}`} rows={2} maxLength={5000} placeholder={draft.mediaUrls.length ? 'Helps the review follow what is said or shown' : 'What you plan to post on Threads or Facebook'} value={draft.text} onChange={(e) => setDrafts((all) => all.map((d, j) => j === i ? { ...d, text: e.target.value } : d))} />
          </fieldset>;
        })}
        {mode === 'compare' && drafts.length < 3 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDrafts((d) => [...d, emptyDraft()])}><Icon name="plus" size={13} /> Add version C</button>}

        <div className="field"><label className="field-label" htmlFor="pf-caption">Caption {mode === 'compare' && '(shared)'}</label><textarea id="pf-caption" rows={2} maxLength={2200} placeholder="The caption you plan to use" value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
        <div className="form-actions">
          <button className="btn btn-ghost" type="button" onClick={() => onOpenChange(false)} disabled={submitting || uploading !== null}>Cancel</button>
          <button className="btn" type="submit" disabled={submitting || uploading !== null || !aiReady || !ready}><Icon name="gauge" size={15} /> {submitting ? 'Queueing…' : mode === 'compare' ? 'Queue comparison' : 'Queue check'}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
