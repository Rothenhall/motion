const DEFAULT = 'http://localhost:3000';

/** Every address the web app is served from (`FRONTEND_URL` may list several, comma separated). Never empty. */
export function frontendOrigins(): string[] {
  const list = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  return list.length ? list : [DEFAULT];
}

/** The address used in links we send out (invites, resets) and in redirects after connecting a channel: the first one. */
export const frontendUrl = () => frontendOrigins()[0];
