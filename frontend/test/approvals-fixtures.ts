import type { ApprovalItem } from '@/lib/approvals';

/** A queue item for tests; override only what the test cares about. */
export function item(over: Partial<ApprovalItem> & { id: string }): ApprovalItem {
  return {
    client: { id: 'c1', name: 'Acme' },
    account: { id: 'a1', provider: 'instagram', name: 'acme.studio' },
    platform: 'instagram',
    mediaType: 'IMAGE',
    caption: `Caption for ${over.id}`,
    mediaUrls: [],
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    submittedBy: { id: 'u1', email: 'sam@acme.test' },
    approvalStatus: 'PENDING',
    approvalNote: null,
    approvalDecidedAt: null,
    pastDue: false,
    ...over,
  };
}

export const staffMe = { id: 'u0', email: 'admin@motion.test', role: 'ADMIN' as const, client: null, features: null, acting: false, readOnlyPreview: false, canActAs: true };
export const clientMe = (requireApproval: boolean) => ({ id: 'u1', email: 'sam@acme.test', role: 'CLIENT_MEMBER' as const, client: { id: 'c1', name: 'Acme', status: 'ACTIVE', requireApproval }, features: {}, acting: false, readOnlyPreview: false, canActAs: false });
