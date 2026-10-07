'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import './shell.css';
import { exitPreview, startPreview } from '../lib/preview';
import { useMe } from '../lib/session';

type Mode = 'view' | 'admin';

/**
 * Shown while staff look at a client's workspace. It sits above everything, tells them which client and what they may do,
 * and lets them switch between read only and admin controls or leave. The state comes from the server's answer to
 * "who am I", so the bar never disagrees with what requests actually do.
 */
export default function PreviewBar() {
  const me = useMe();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const acting = !!me?.acting && !!me.client;
  const mode: Mode = me?.readOnlyPreview ? 'view' : 'admin';

  // The sidebar and top bar sit below this bar; they read its height from here (see shell.css).
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!acting || !el) { root.style.removeProperty('--preview-h'); return; }
    const measure = () => root.style.setProperty('--preview-h', `${el.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); root.style.removeProperty('--preview-h'); };
  }, [acting]);

  // A mode switch is finished once the server reports the new mode.
  useEffect(() => { setBusy(false); }, [mode]);

  if (!me || !acting || !me.client) return null;
  const client = { id: me.client.id, name: me.client.name };

  const switchTo = async (next: Mode) => {
    if (next === mode || busy) return;
    setBusy(true);
    try { await startPreview(client, next); }
    catch (e) { setBusy(false); toast.error(e instanceof Error ? e.message : 'Could not change the preview.'); }
  };

  const leave = async () => {
    setBusy(true);
    try { await exitPreview(client.id); }
    catch { /* the preview is cleared either way */ }
    router.push(`/admin/clients/${client.id}`);
  };

  return (
    <div className={`preview-bar preview-${mode}`} ref={ref} role="region" aria-label="Preview">
      <div className="preview-copy">
        <strong className="preview-title">Previewing {client.name}</strong>
        <span className="preview-note" role="status" aria-live="polite">
          {mode === 'view' ? 'Read only. You see what the client sees.' : 'Admin controls on. Changes apply to the client.'}
        </span>
      </div>
      <div className="preview-actions">
        <div className="preview-switch" role="group" aria-label="Preview mode">
          <button type="button" aria-pressed={mode === 'view'} disabled={busy} onClick={() => switchTo('view')}>View as client</button>
          <button type="button" aria-pressed={mode === 'admin'} disabled={busy} onClick={() => switchTo('admin')}>Admin controls</button>
        </div>
        <button type="button" className="preview-exit" disabled={busy} onClick={leave}>Exit preview</button>
      </div>
    </div>
  );
}
