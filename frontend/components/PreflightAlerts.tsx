'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';

type Row = { id: string; label: string | null; status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED'; kind: string; hook?: { score: number } | null };

const POLL_MS = 30_000;
const isBusy = (s: Row['status']) => s === 'PENDING' || s === 'RUNNING';

/**
 * Reel checks take 10 to 16 minutes, so people leave the page. This watches the list while the app is open and
 * announces a check the moment it finishes, wherever you are, with a link to the result.
 */
export default function PreflightAlerts() {
  const router = useRouter();
  const running = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const rows = await api<Row[]>('/preflight');
        if (stop || !rows) return;
        for (const row of rows) {
          const title = row.label || (row.kind === 'VIDEO' ? 'Your reel' : 'Your post');
          if (isBusy(row.status)) { running.current.set(row.id, title); continue; }
          // Only announce a check we saw running, so opening the app never replays old results.
          if (!running.current.has(row.id)) continue;
          running.current.delete(row.id);
          if (row.status === 'DONE') {
            toast.success('Pre-flight check finished', { description: `${title}${row.hook ? ` · hook ${Math.round(row.hook.score)}/100` : ''}`, duration: 12_000, action: { label: 'See result', onClick: () => router.push(`/preflight/${row.id}`) } });
          } else if (row.status === 'FAILED') {
            toast.error('A pre-flight check failed', { description: title, duration: 12_000, action: { label: 'Open', onClick: () => router.push(`/preflight/${row.id}`) } });
          }
        }
      } catch { /* signed out or offline: try again on the next tick */ }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [router]);

  return null;
}
