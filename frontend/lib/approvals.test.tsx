import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientMe, staffMe } from '../test/approvals-fixtures';

const h = vi.hoisted(() => ({ me: null as any, api: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), api: h.api }));
vi.mock('./session', async (orig) => ({ ...(await orig<typeof import('./session')>()), useMe: () => h.me }));

import { ApiError } from './api';
import { approvalView, approve, decisionError, notifyApprovalsChanged, requestChanges, resubmit, setRequireApproval, useApprovalCount } from './approvals';

describe('approval API wrappers', () => {
  beforeEach(() => { h.api.mockReset(); h.api.mockResolvedValue({}); });

  it('calls the contract paths', async () => {
    await approve('p1');
    await approve('p2', '2030-01-01T10:00:00.000Z');
    await requestChanges('p3', 'Shorter please');
    await resubmit('p4');
    await setRequireApproval('c9', true);
    expect(h.api.mock.calls.map((c) => [c[0], c[1]?.method, c[1]?.body])).toEqual([
      ['/admin/approvals/p1/approve', 'POST', '{}'],
      ['/admin/approvals/p2/approve', 'POST', '{"scheduledAt":"2030-01-01T10:00:00.000Z"}'],
      ['/admin/approvals/p3/request-changes', 'POST', '{"note":"Shorter please"}'],
      ['/posts/p4/resubmit', 'POST', undefined],
      ['/admin/clients/c9', 'PATCH', '{"requireApproval":true}'],
    ]);
  });

  it('turns error codes into plain words', () => {
    expect(decisionError(new ApiError('x', 409, 'NOT_PENDING')).message).toBe('Already decided');
    expect(decisionError(new ApiError('x', 400, 'SCHEDULE_TIME_PASSED')).message).toMatch(/future/);
    expect(decisionError(new ApiError('x', 409, 'CHANNEL_DISCONNECTED')).message).toMatch(/disconnected/);
    expect(decisionError(new ApiError('Boom', 500)).message).toBe('Boom');
  });

  it('reads the approval state of a post', () => {
    expect(approvalView({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' })).toBe('awaiting');
    expect(approvalView({ status: 'PENDING_APPROVAL', approvalStatus: 'CHANGES_REQUESTED' })).toBe('changes');
    expect(approvalView({ status: 'SCHEDULED', approvalStatus: 'APPROVED' })).toBe('approved');
    expect(approvalView({ status: 'SCHEDULED', approvalStatus: null })).toBeNull();
    expect(approvalView({ status: 'PUBLISHED', approvalStatus: 'APPROVED' })).toBeNull();
  });
});

describe('useApprovalCount', () => {
  beforeEach(() => { vi.useFakeTimers(); h.api.mockReset(); h.api.mockResolvedValue({ pending: 4 }); });
  afterEach(() => { vi.useRealTimers(); });
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('makes no request for clients or while signed out', async () => {
    h.me = clientMe(true);
    const { result } = renderHook(() => useApprovalCount());
    await tick(120_000);
    expect(h.api).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(0);
    h.me = null;
  });

  it('reads at once, then about every minute, for staff', async () => {
    h.me = staffMe;
    const { result, unmount } = renderHook(() => useApprovalCount());
    await tick(10);
    expect(h.api).toHaveBeenCalledWith('/admin/approvals/count');
    expect(result.current.pending).toBe(4);
    h.api.mockResolvedValue({ pending: 2 });
    await tick(60_000);
    expect(result.current.pending).toBe(2);
    expect(h.api).toHaveBeenCalledTimes(2);
    unmount();
    await tick(120_000);
    expect(h.api).toHaveBeenCalledTimes(2);
  });

  it('skips polling while the tab is hidden and reads again when it returns', async () => {
    h.me = staffMe;
    renderHook(() => useApprovalCount());
    await tick(10);
    expect(h.api).toHaveBeenCalledTimes(1);
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick(180_000);
    expect(h.api).toHaveBeenCalledTimes(1);
    state.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(h.api).toHaveBeenCalledTimes(2);
    state.mockRestore();
  });

  it('refreshes after a decision is announced, and keeps the last count when a read fails', async () => {
    h.me = staffMe;
    const { result } = renderHook(() => useApprovalCount());
    await tick(10);
    h.api.mockResolvedValue({ pending: 3 });
    await act(async () => { notifyApprovalsChanged(); });
    expect(result.current.pending).toBe(3);
    h.api.mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.pending).toBe(3);
  });
});
