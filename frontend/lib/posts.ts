import { api } from './api';
import { platformFor, type Platform } from './format';
import { parseMedia } from './media';

export type Post = {
  id: string;
  accountId?: string;
  platform: string;
  mediaType: string;
  caption?: string | null;
  mediaUrls?: string;
  scheduledAt: string;
  status: string;
  error?: string | null;
  permalink?: string | null;
  idea?: { id: string; title: string } | null;
  account?: { id?: string; provider: string; name?: string | null; externalId?: string };
};

export const postPlatform = (post: Post): Platform => platformFor(post.account?.provider || post.platform);

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day key, so a post at 11pm lands on the day the user sees. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export function startOfWeek(d: Date) {
  const day = startOfDay(d);
  return new Date(day.getTime() - ((day.getDay() + 6) % 7) * DAY_MS);
}

export const fmtTime = (value: string | Date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export const fmtDay = (value: string | Date) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));

/** Local `YYYY-MM-DDTHH:mm` for a datetime-local input. */
export const toLocalInput = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Moves a scheduled post to a new time. The post keeps its id, so its insights and links stay attached. */
export async function reschedule(post: Pick<Post, 'id'>, when: Date) {
  await api(`/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: when.toISOString() }) });
}

/** A post still being written, autosaved from the composer. */
export type Draft = {
  id: string;
  accountId?: string | null;
  platform?: string | null;
  mediaType: string;
  caption?: string | null;
  mediaUrls: string;
  scheduledAt?: string | null;
  ideaId?: string | null;
  updatedAt: string;
};

/** A scheduled post that needs a photo or video but has none, so it would fail when it goes out. */
export const needsMedia = (p: Post) => p.status === 'SCHEDULED' && p.mediaType !== 'TEXT' && parseMedia(p.mediaUrls).length === 0;
