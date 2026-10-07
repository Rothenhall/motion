/**
 * What the uploader names a file: a timestamp, a random part and the extension. New files get 32 hex characters (128 bits)
 * so a name cannot be guessed; files from before that have 8, and stay readable.
 */
export const UPLOAD_NAME = /^\d+-(?:[0-9a-f]{32}|[0-9a-f]{8})\.([a-z0-9]+)$/;

/**
 * The upload file name a media URL points at, or null for any other link. Only the last path segment counts, decoded the
 * way the file server decodes it, so "/media/%31000-...", "/media//1000-..." and a different host all still resolve to
 * the file they would serve. Matching is case-insensitive and answers the lower-case name.
 */
export function uploadNameOf(url: unknown): string | null {
  try {
    const last = new URL(String(url)).pathname.split('/').pop() || '';
    const name = decodeURIComponent(last).toLowerCase();
    return UPLOAD_NAME.test(name) ? name : null;
  } catch { return null; }
}

/** The upload file names a stored mediaUrls value (a JSON array of URLs) points at. Other links are ignored. */
export function uploadNamesIn(json: string | null | undefined): string[] {
  try {
    const urls: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(urls)) return [];
    return urls.flatMap((u) => { const name = uploadNameOf(u); return name ? [name] : []; });
  } catch { return []; }
}
