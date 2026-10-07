const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];

/** "3 hours ago", "yesterday". Falls back to "just now" for the last minute. */
export function timeAgo(value: string | Date, now = Date.now()): string {
  const diff = new Date(value).getTime() - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export const whenLong = (value: string | Date) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
