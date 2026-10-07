'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Fetch again. Keeps showing the old data while it loads. */
  reload: () => Promise<void>;
  /** Replace the data without a request, for example with the server's answer to a save. */
  setData: (next: T) => void;
}

/**
 * Loads something when the page opens and whenever `deps` change. A slow answer to an old request is thrown away, so
 * changing a filter quickly never shows stale results.
 */
export function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    const mine = ++latest.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      if (mine === latest.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (mine === latest.current) setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : 'Something went wrong.', loading: false }));
    }
  }, []);

  useEffect(() => {
    void run();
    return () => { latest.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((next: T) => setState({ data: next, error: null, loading: false }), []);
  return { ...state, reload: run, setData };
}

/** Sets the browser tab title the way the rest of the app does: "Page · Motion". */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Motion`;
  }, [title]);
}

/** A value that follows `value` after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Runs an async action, tracking whether it is in progress so buttons can show progress and disable. */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    try { return await action(); }
    finally { setBusy(null); }
  }, []);
  return { busy, run };
}
