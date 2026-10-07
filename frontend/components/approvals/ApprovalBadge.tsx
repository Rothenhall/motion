'use client';

import { APPROVAL_LABEL, approvalView, type ApprovalStatus, type ApprovalView } from '@/lib/approvals';
import './approvals.css';

/** The approval state of a post as a chip: Awaiting approval, Changes requested or Approved. Renders nothing otherwise. */
export function ApprovalBadge({ view, post }: { view?: ApprovalView | null; post?: { status: string; approvalStatus?: ApprovalStatus | null } }) {
  const v = view ?? (post ? approvalView(post) : null);
  if (!v) return null;
  return <span className={`ap-pill ap-${v}`}>{APPROVAL_LABEL[v]}</span>;
}

/** The decision on an item staff already handled. */
export function DecisionBadge({ status }: { status: ApprovalStatus }) {
  if (status === 'APPROVED') return <span className="ap-pill ap-approved">Approved</span>;
  if (status === 'CHANGES_REQUESTED') return <span className="ap-pill ap-changes">Changes requested</span>;
  return <span className="ap-pill ap-awaiting">Awaiting approval</span>;
}
