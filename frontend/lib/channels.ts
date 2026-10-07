const DAY_MS = 86_400_000;

/** A channel whose sign-in is about to run out (or already has) needs the account manager to reconnect it. */
export function expiryWarning(tokenExpires?: string | null, now = Date.now()): string | null {
  if (!tokenExpires) return null;
  const left = new Date(tokenExpires).getTime() - now;
  if (Number.isNaN(left)) return null;
  if (left <= 0) return 'Needs reconnecting';
  const days = Math.max(1, Math.ceil(left / DAY_MS));
  if (left < 7 * DAY_MS) return `Expires in ${days} day${days === 1 ? '' : 's'}`;
  return null;
}
