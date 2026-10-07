/** Shared pieces of the approval workflow: states, and the shapes sent to the web app. */

export const PENDING_APPROVAL = 'PENDING_APPROVAL'; // post status: waiting for staff, never published by the scheduler
export const AP_PENDING = 'PENDING';
export const AP_APPROVED = 'APPROVED';
export const AP_CHANGES = 'CHANGES_REQUESTED';

/** What a post looks like when it goes back to the review queue: no decision, no note. */
export const BACK_TO_PENDING = {
  status: PENDING_APPROVAL,
  approvalStatus: AP_PENDING,
  approvalNote: null,
  approvalDecidedAt: null,
  approvalDecidedById: null,
} as const;

/** A post row without the id of the staff member who decided it (internal). */
export function publicPost<T extends { approvalDecidedById?: string | null }>(post: T): Omit<T, 'approvalDecidedById'> {
  const { approvalDecidedById: _hidden, ...rest } = post;
  return rest;
}

export function parseUrls(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

export const itemInclude = {
  account: { select: { id: true, provider: true, name: true, clientId: true, client: { select: { id: true, name: true } } } },
} as const;

type ItemRow = {
  id: string;
  platform: string;
  mediaType: string;
  caption: string | null;
  mediaUrls: string;
  scheduledAt: Date;
  createdAt: Date;
  createdById: string | null;
  status: string;
  approvalStatus: string | null;
  approvalNote: string | null;
  approvalDecidedAt: Date | null;
  account: { id: string; provider: string; name: string | null; client: { id: string; name: string } | null };
};

/** One post in the staff approval lists. `pastDue` means it still waits for a decision and its time has passed. */
export function approvalItem(p: ItemRow, users: Map<string, string>) {
  return {
    id: p.id,
    client: p.account.client ? { id: p.account.client.id, name: p.account.client.name } : { id: '', name: '' },
    account: { id: p.account.id, provider: p.account.provider, name: p.account.name },
    platform: p.platform,
    mediaType: p.mediaType,
    caption: p.caption,
    mediaUrls: parseUrls(p.mediaUrls),
    scheduledAt: p.scheduledAt,
    createdAt: p.createdAt,
    submittedBy: p.createdById && users.has(p.createdById) ? { id: p.createdById, email: users.get(p.createdById) as string } : null,
    approvalStatus: p.approvalStatus,
    approvalNote: p.approvalNote,
    approvalDecidedAt: p.approvalDecidedAt,
    pastDue: p.status === PENDING_APPROVAL && p.scheduledAt.getTime() <= Date.now(),
  };
}
