'use client';

import { useEffect } from 'react';
import { Icon } from '@/components/Icons';

/** Shown inside the app shell when a screen crashes, so the sidebar still works and the person can try again. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="empty-state" role="alert">
      <div className="empty-icon"><Icon name="alert" size={18} /></div>
      <strong>Something went wrong on this page</strong>
      Anything you saved is safe. Try again, and if it keeps happening, reload the page.
      <br /><button className="btn btn-sm" type="button" onClick={reset} style={{ marginTop: 12 }}>Try again</button>
    </div>
  );
}
