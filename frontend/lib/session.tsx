'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ACTING_EVENT, ApiError, api, getToken } from './api';

export type Role = 'ADMIN' | 'CLIENT_POC' | 'CLIENT_MEMBER';

/** The twelve switches (see backend/src/tenancy/features.constants.ts). */
export type FeatureKey =
  | 'planner' | 'content-lab' | 'preflight' | 'inbox' | 'automations' | 'analytics'
  | 'compose' | 'schedule' | 'delete-posts' | 'inbox-reply' | 'edit-brand' | 'ai';

/** What `GET /auth/me` returns. */
export interface Me {
  id: string;
  email: string;
  role: Role;
  /** The workspace the requests are about: the user's own, or the one staff are acting as. */
  client: { id: string; name: string; status: string; requireApproval?: boolean } | null;
  /** That workspace's switches. Staff are never blocked by them on the server, but see them in a read-only preview. */
  features: Record<string, boolean> | null;
  /** Staff acting as a client other than their own workspace. */
  acting: boolean;
  /** Acting in "view as client" mode: the server refuses writes. */
  readOnlyPreview: boolean;
  canActAs: boolean;
}

export type SessionStatus =
  | 'loading'    // asking the server who this is
  | 'anonymous'  // no token (the shell sends people to /login)
  | 'ready'      // `me` is loaded
  | 'suspended'  // the client's workspace is paused
  | 'error';     // the server could not be reached

interface SessionValue {
  status: SessionStatus;
  me: Me | null;
  error: string | null;
  /** Reload `/auth/me`, for example after the acting client or the switches changed. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({ status: 'loading', me: null, error: null, refresh: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ status: SessionStatus; me: Me | null; error: string | null }>({ status: 'loading', me: null, error: null });

  const refresh = useCallback(async () => {
    if (!getToken()) { setState({ status: 'anonymous', me: null, error: null }); return; }
    try {
      const me = await api<Me>('/auth/me');
      setState({ status: 'ready', me, error: null });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CLIENT_SUSPENDED') setState({ status: 'suspended', me: null, error: e.message });
      else if (e instanceof ApiError && e.status === 401) setState({ status: 'anonymous', me: null, error: null }); // api() is already sending them to /login
      else setState({ status: 'error', me: null, error: e instanceof Error ? e.message : 'Could not reach Motion.' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Starting or leaving a preview changes who the requests are about, so everything is read again.
    window.addEventListener(ACTING_EVENT, refresh);
    return () => window.removeEventListener(ACTING_EVENT, refresh);
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

/** The signed-in user, or null while loading or signed out. */
export const useMe = () => useContext(SessionContext).me;

export const isStaff = (me: Me | null | undefined) => me?.role === 'ADMIN';

/**
 * Whether the app should offer a section or action. Staff see everything, except in a read-only "view as client" preview,
 * where they see exactly what the client sees. Clients follow their workspace's switches. Anything unknown is on, which
 * matches the server (switches default on) and means a new switch never hides things by accident.
 */
export function featureOn(me: Me | null | undefined, key: FeatureKey): boolean {
  if (!me) return false;
  if (me.role === 'ADMIN' && !me.readOnlyPreview) return true;
  return me.features?.[key] !== false;
}

export const useFeature = (key: FeatureKey) => featureOn(useMe(), key);
