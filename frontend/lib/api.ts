export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const TOKEN_KEY = 'motion-session';

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Session expired or missing: drop it and send the user to sign in. */
export function signOut() {
  setToken(null);
  if (window.location.pathname !== '/login') window.location.assign('/login');
}

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts?.headers || {}) },
  });
  if (response.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/register')) {
    signOut();
    throw new Error('Please sign in again.');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      message = payload.message || payload.error || message;
      if (Array.isArray(message)) message = message.join(', ');
    } catch { /* keep the status fallback */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  // Nest serialises a null result as an empty 200 body, which response.json() rejects.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}
