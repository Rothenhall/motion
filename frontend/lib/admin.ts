import { api } from './api';

// Types and typed wrappers for the staff API (`/admin/*`). Admin routes never carry preview headers (see api()).

export type ClientStatus = 'ACTIVE' | 'SUSPENDED';
export type UserRole = 'ADMIN' | 'CLIENT_POC' | 'CLIENT_MEMBER';
export type UserStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';

export interface ClientChannel { id: string; provider: string; name: string | null }

/** A client row, as `GET /admin/clients` and the single-client routes return it. */
export interface ClientRow {
  id: string;
  name: string;
  status: ClientStatus;
  archived: boolean;
  staffWorkspace: boolean;
  seatLimit: number;
  seatsUsed: number;
  pendingInvites: number;
  requireApproval?: boolean;
  notes: string | null;
  createdAt: string;
  channels: ClientChannel[];
  disconnectedChannels: number;
  scheduledPosts: number;
  failedPosts: number;
  lastActivityAt: string | null;
}

export type FeatureMap = Record<string, boolean>;
export interface ClientDetail extends ClientRow { features: FeatureMap }

export interface InviteLink { email: string; url: string; expiresAt: string }

export interface Overview {
  clients: { active: number; suspended: number };
  channels: { connected: number; disconnected: number };
  posts: { scheduled: number; failed: number; dueWithin24h: number };
  pendingInvites: number;
  attention: { clientId: string; name: string; reasons: string[] }[];
}

export interface FeaturesPayload {
  features: FeatureMap;
  defaults: FeatureMap;
  groups: { sections: string[]; actions: string[] };
}

export interface Member {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  hasPassword: boolean;
}
export interface TeamPayload { members: Member[]; seats: { used: number; limit: number } }

export interface AdminChannel {
  id: string;
  provider: string;
  name: string | null;
  externalId: string;
  connected: boolean;
  connectedAt: string;
  disconnectedAt: string | null;
  tokenExpires: string | null;
  insightsSyncedAt: string | null;
  insightsError: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  actor: { id: string; email: string | null };
}

export type ClientFilter = 'all' | 'active' | 'suspended' | 'archived';

const json = (body: unknown) => JSON.stringify(body);
const base = (id: string) => `/admin/clients/${encodeURIComponent(id)}`;

export const getOverview = () => api<Overview>('/admin/overview');

export function listClients(opts: { q?: string; status?: ClientFilter } = {}) {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set('q', opts.q.trim());
  if (opts.status && opts.status !== 'all') params.set('status', opts.status);
  const query = params.toString();
  return api<ClientRow[]>(`/admin/clients${query ? `?${query}` : ''}`);
}

export const createClient = (name: string, pocEmail: string) =>
  api<{ client: ClientRow; invite: InviteLink }>('/admin/clients', { method: 'POST', body: json({ name, pocEmail }) });

export const getClient = (id: string) => api<ClientDetail>(base(id));
export const updateClient = (id: string, patch: { name?: string; notes?: string | null; requireApproval?: boolean }) =>
  api<ClientRow>(base(id), { method: 'PATCH', body: json(patch) });
export const clientAction = (id: string, action: 'suspend' | 'activate' | 'archive' | 'unarchive') =>
  api<ClientRow>(`${base(id)}/${action}`, { method: 'POST' });
export const setSeatLimit = (id: string, seatLimit: number) =>
  api<ClientRow>(`${base(id)}/seats`, { method: 'PATCH', body: json({ seatLimit }) });

export const getFeatures = (id: string) => api<FeaturesPayload>(`${base(id)}/features`);
export const saveFeatures = (id: string, changes: FeatureMap) => api<FeaturesPayload>(`${base(id)}/features`, { method: 'PUT', body: json(changes) });

export const getTeam = (id: string) => api<TeamPayload>(`${base(id)}/users`);
export const inviteMember = (id: string, email: string, role: 'CLIENT_MEMBER' | 'CLIENT_POC') =>
  api<{ user: Member; invite: InviteLink }>(`${base(id)}/invite`, { method: 'POST', body: json({ email, role }) });
export const resendInvite = (userId: string) => api<{ invite: InviteLink }>(`/admin/users/${encodeURIComponent(userId)}/resend-invite`, { method: 'POST' });
export const resetLink = (userId: string) => api<{ reset: InviteLink }>(`/admin/users/${encodeURIComponent(userId)}/reset-link`, { method: 'POST' });
export const disableUser = (userId: string) => api<Member>(`/admin/users/${encodeURIComponent(userId)}/disable`, { method: 'POST' });
export const enableUser = (userId: string) => api<Member>(`/admin/users/${encodeURIComponent(userId)}/enable`, { method: 'POST' });

export const getChannels = (id: string) => api<AdminChannel[]>(`${base(id)}/channels`);
export const getAudit = (id: string) => api<AuditEntry[]>(`${base(id)}/audit`);

/**
 * Calls that are about a client but not under /admin name it with a header. `X-Preview-Mode: admin` makes sure a read-only
 * preview left open in this tab cannot block staff from managing the client they are looking at.
 */
export const forClient = (clientId: string): Record<string, string> => ({ 'X-Client-Id': clientId, 'X-Preview-Mode': 'admin' });

export type ConnectProvider = 'instagram' | 'facebook' | 'threads';

/** The route name for the connect flow, from a stored provider ("facebook_page" connects through "facebook"). */
export const connectRouteFor = (provider: string): ConnectProvider => (provider === 'facebook_page' || provider === 'facebook' ? 'facebook' : provider === 'threads' ? 'threads' : 'instagram');

export const startConnect = (clientId: string, provider: ConnectProvider) =>
  api<{ url: string }>(`/auth/${provider}/start`, { headers: forClient(clientId) });
export const disconnectChannel = (clientId: string, accountId: string) =>
  api(`/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE', headers: forClient(clientId) });
export const addChannelByToken = (clientId: string, body: { provider: string; externalId: string; name?: string; accessToken: string; tokenExpires?: string }) =>
  api('/accounts', { method: 'POST', body: json(body), headers: forClient(clientId) });

// ---------------------------------------------------------------- small shared helpers

export const roleLabel = (role: string) => (role === 'CLIENT_POC' ? 'Main contact' : role === 'CLIENT_MEMBER' ? 'Member' : role === 'ADMIN' ? 'Staff' : role);

export const providerLabel = (provider: string) => (provider === 'facebook_page' || provider === 'facebook' ? 'Facebook' : provider === 'threads' ? 'Threads' : 'Instagram');

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

/** "5 minutes ago", "in 3 days". Falls back to the plain date when the browser cannot do relative time. */
export function timeAgo(value: string | Date | null | undefined, now: number = Date.now()): string {
  if (!value) return 'Never';
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return 'Unknown';
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800], ['month', 2_592_000], ['year', 31_536_000]];
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let size = 60;
  for (const [u, s] of units) { if (abs >= s) { unit = u; size = s; } }
  const amount = Math.round(seconds / size);
  if (!rtf) return new Date(at).toLocaleDateString();
  return rtf.format(amount, unit);
}

export const exactTime = (value: string | Date | null | undefined) => (value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Which tab of the client best answers a reason like "2 disconnected channels". */
export function tabForReasons(reasons: string[]): string {
  const text = reasons.join(' ').toLowerCase();
  if (text.includes('channel')) return 'channels';
  if (text.includes('invitation')) return 'team';
  return 'overview';
}

export interface ClientPost {
  id: string;
  platform: string;
  status: string;
  caption: string | null;
  scheduledAt: string;
  error?: string | null;
  account?: { provider: string; name: string | null } | null;
}

/** The client's posts, read the way the client's own planner reads them (staff may, whatever the switches say). */
export const getClientPosts = (clientId: string) => api<ClientPost[]>('/posts', { headers: forClient(clientId) });
