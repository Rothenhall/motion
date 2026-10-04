export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) },
  });
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
  return response.json();
}
