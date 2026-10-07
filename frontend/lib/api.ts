export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const TOKEN_KEY = 'motion-session';
const ACTING_KEY = 'motion-acting';
/** Fired on window whenever the acting client changes, so the session can reload `/auth/me`. */
export const ACTING_EVENT = 'motion:acting';

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

/**
 * The client staff are acting as. `view` is a read-only preview (the server refuses writes and the app shows exactly what
 * the client sees); `admin` can make changes. Kept per browser tab, so two tabs can look at two clients.
 */
export interface ActingClient { id: string; name: string; mode: 'view' | 'admin' }

export function getActing(): ActingClient | null {
  try {
    const raw = window.sessionStorage.getItem(ACTING_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.id === 'string' && typeof value.name === 'string' && (value.mode === 'view' || value.mode === 'admin')) return value;
  } catch { /* storage unavailable or malformed */ }
  return null;
}

export function setActing(acting: ActingClient | null) {
  try {
    if (acting) window.sessionStorage.setItem(ACTING_KEY, JSON.stringify(acting));
    else window.sessionStorage.removeItem(ACTING_KEY);
  } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new Event(ACTING_EVENT)); } catch { /* not in a browser */ }
}

/**
 * The single place request headers are built, so no call can forget who it is acting for. Staff routes (`/admin/...`) pass
 * `{ acting: false }`: they name the client in the URL, and in a read-only preview they must still be able to write.
 */
export function authHeaders(options: { acting?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const acting = options.acting === false ? null : getActing();
  if (acting) {
    headers['X-Client-Id'] = acting.id;
    if (acting.mode === 'view') headers['X-Preview-Mode'] = 'view';
  }
  return headers;
}

/** Session expired or missing: drop it and send the user to sign in. */
export function signOut() {
  setToken(null);
  setActing(null);
  if (window.location.pathname !== '/login') window.location.assign('/login');
}

/**
 * A failed request. `code` is the server's machine-readable reason when it gives one (FEATURE_DISABLED, PREVIEW_READ_ONLY,
 * CLIENT_SUSPENDED, SEAT_LIMIT, CHANNEL_ALREADY_CONNECTED, ...) and `feature` names the switch for FEATURE_DISABLED.
 * Pages use these to handle one blocked widget without breaking the rest of the page.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  feature?: string;
  constructor(message: string, status: number, code?: string, feature?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.feature = feature;
  }
}

/** What anyone sees when a write is tried in a read-only preview (the server's own wording is replaced, so every page says the same). */
export const PREVIEW_READ_ONLY_MESSAGE = 'This preview is read only. Switch on admin controls to make changes.';

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code);

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders({ acting: !path.startsWith('/admin/') }), ...(opts?.headers || {}) },
  });
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    signOut();
    throw new ApiError('Please sign in again.', 401);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let code: string | undefined;
    let feature: string | undefined;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
      if (Array.isArray(message)) message = message.join(', ');
      if (typeof payload.code === 'string') code = payload.code;
      if (typeof payload.feature === 'string') feature = payload.feature;
    } catch { /* keep the status fallback */ }
    if (code === 'PREVIEW_READ_ONLY') message = PREVIEW_READ_ONLY_MESSAGE;
    throw new ApiError(message, response.status, code, feature);
  }
  if (response.status === 204) return undefined as T;
  // Nest serialises a null result as an empty 200 body, which response.json() rejects.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
