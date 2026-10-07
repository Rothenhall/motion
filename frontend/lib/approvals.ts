import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { isStaff, useMe } from './session';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';

/** One post in the approval queue, as the staff endpoints return it. */
export interface ApprovalItem {
  id: string;
  client: { id: string; name: string };
  account: { id: string; provider: string; name: string | null };
  platform: string;
  mediaType: string;
  caption: string | null;
  mediaUrls: string[];
  scheduledAt: string;
  createdAt: string;
  submittedBy: { id: string; email: string } | null;
  approvalStatus: ApprovalStatus;
  approvalNote: string | null;
  approvalDecidedAt: string | null;
  /** The scheduled time has already passed, so approving needs a new time. */
  pastDue: boolean;
}

export const NOTE_MIN = 3;
export const NOTE_MAX = 500;

/** Fired on window after a decision, so any badge on the page can read the count again at once. */
export const APPROVALS_EVENT = 'motion:approvals';
export const notifyApprovalsChanged = () => {
  try { window.dispatchEvent(new Event(APPROVALS_EVENT)); } catch { /* not in a browser */ }
};

export const listApprovals = (clientId?: string) =>
  api<{ items: ApprovalItem[]; total: number }>(`/admin/approvals${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`);

export const clientApprovals = (id: string) =>
  api<{ pending: ApprovalItem[]; recent: ApprovalItem[] }>(`/admin/clients/${encodeURIComponent(id)}/approvals`);

export const approvalCount = async () => (await api<{ pending: number }>('/admin/approvals/count'))?.pending ?? 0;

/** Approves a post. Pass a new future time when the old one has passed. */
export const approve = (postId: string, scheduledAt?: string) =>
  api(`/admin/approvals/${encodeURIComponent(postId)}/approve`, { method: 'POST', body: JSON.stringify(scheduledAt ? { scheduledAt } : {}) });

export const requestChanges = (postId: string, note: string) =>
  api(`/admin/approvals/${encodeURIComponent(postId)}/request-changes`, { method: 'POST', body: JSON.stringify({ note }) });

/** Client side: send a changes-requested post back for review. */
export const resubmit = (postId: string) => api(`/posts/${encodeURIComponent(postId)}/resubmit`, { method: 'POST' });

export const setRequireApproval = (clientId: string, on: boolean) =>
  api(`/admin/clients/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: JSON.stringify({ requireApproval: on }) });

/** Plain words for the errors a decision can run into. */
export function decisionError(e: unknown, fallback = 'Something went wrong. Try again.'): { code?: string; message: string } {
  if (e instanceof ApiError) {
    if (e.code === 'NOT_PENDING') return { code: e.code, message: 'Already decided' };
    if (e.code === 'SCHEDULE_TIME_PASSED') return { code: e.code, message: 'That time has already passed. Pick a time in the future.' };
    if (e.code === 'CHANNEL_DISCONNECTED') return { code: e.code, message: 'This channel is disconnected, so the post cannot be scheduled. Reconnect it in the client’s Channels tab, then approve again.' };
    return { code: e.code, message: e.message || fallback };
  }
  return { message: e instanceof Error ? e.message : fallback };
}

/**
 * How many posts wait for approval, for the nav badge. Staff only: anyone else gets 0 and no request is made.
 * Reads the count about once a minute while the tab is visible, when the tab comes back, and after any decision.
 */
export function useApprovalCount(intervalMs = 60_000): { pending: number; refresh: () => Promise<void> } {
  const staff = isStaff(useMe());
  const [pending, setPending] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!staff) return;
    try {
      const n = await approvalCount();
      if (alive.current) setPending(n);
    } catch { /* a badge never complains; the next read tries again */ }
  }, [staff]);

  useEffect(() => {
    if (!staff) { setPending(0); return; }
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (visible()) void refresh();
    const timer = window.setInterval(() => { if (visible()) void refresh(); }, intervalMs);
    const onVisible = () => { if (visible()) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(APPROVALS_EVENT, onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(APPROVALS_EVENT, onVisible);
    };
  }, [staff, intervalMs, refresh]);

  return { pending: staff ? pending : 0, refresh };
}

export type ApprovalView = 'awaiting' | 'changes' | 'approved';

/** The approval state a client sees on one of their posts, or null when approval is not involved. */
export function approvalView(post: { status: string; approvalStatus?: ApprovalStatus | null }): ApprovalView | null {
  if (post.status === 'PENDING_APPROVAL') return post.approvalStatus === 'CHANGES_REQUESTED' ? 'changes' : 'awaiting';
  if (post.approvalStatus === 'APPROVED' && post.status === 'SCHEDULED') return 'approved';
  return null;
}

export const APPROVAL_LABEL: Record<ApprovalView, string> = { awaiting: 'Awaiting approval', changes: 'Changes requested', approved: 'Approved' };
