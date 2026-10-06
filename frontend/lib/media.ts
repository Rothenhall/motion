// Helpers for the media attached to posts, so every screen reads it the same way.
import { API } from './api';

/**
 * Uploads are stored with PUBLIC_BASE_URL (the public tunnel Meta fetches from). In the browser, show them from the
 * API directly: the tunnel may be offline, and ngrok's free tier answers browsers with a warning page instead of the file.
 */
export const mediaSrc = (url: string) => {
  try {
    const { pathname } = new URL(url);
    return pathname.startsWith('/media/') ? `${API}${pathname}` : url;
  } catch { return url; }
};

/** mediaUrls is stored as a JSON string on posts; checks may already hold an array. */
export function parseMedia(value?: string | string[] | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((u) => typeof u === 'string');
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === 'string') : [];
  } catch { return []; }
}

export const isVideoUrl = (url: string) => /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);

/** A stable muted tone for posts that have no media (text posts, or media that failed to load). */
export function toneFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `st-tone-${(hash % 8) + 1}`;
}
