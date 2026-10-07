/** What the uploader names a file: a timestamp, eight hex characters and the extension. */
export const UPLOAD_NAME = /^\d+-[0-9a-f]{8}\.([a-z0-9]+)$/;

/** The upload file names a stored mediaUrls value (a JSON array of URLs) points at. Other links are ignored. */
export function uploadNamesIn(json: string | null | undefined): string[] {
  try {
    const urls: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(urls)) return [];
    return urls.flatMap((u) => {
      try {
        const name = new URL(String(u)).pathname.replace(/^\/media\//, '');
        return UPLOAD_NAME.test(name) ? [name] : [];
      } catch { return []; }
    });
  } catch { return []; }
}
