import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientMe, staffMe } from '../../test/approvals-fixtures';

const h = vi.hoisted(() => ({
  me: null as any,
  api: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: h.api, authHeaders: () => ({}) }));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: h.api, authHeaders: () => ({}) }));
vi.mock('@/lib/session', async (orig) => ({ ...(await orig<typeof import('@/lib/session')>()), useMe: () => h.me }));
vi.mock('../../lib/session', async (orig) => ({ ...(await orig<typeof import('../../lib/session')>()), useMe: () => h.me }));
vi.mock('sonner', () => ({ toast: h.toast }));

import Composer from '../Composer';
import PostDrawer from '../studio/PostDrawer';
import type { Post } from '@/lib/posts';

const accounts = [{ id: 'acc-1', provider: 'instagram', externalId: 'ig-1', name: 'Studio' }];
const post = (over: Partial<Post>): Post => ({
  id: 'post1', platform: 'instagram', mediaType: 'IMAGE', caption: 'My caption', mediaUrls: '[]',
  scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), status: 'SCHEDULED', approvalStatus: null, approvalNote: null,
  account: { provider: 'instagram', name: 'Studio' }, ...over,
});

describe('Composer wording', () => {
  beforeEach(() => { h.api.mockReset(); h.api.mockResolvedValue([]); h.toast.success.mockReset(); });

  const fill = async () => {
    render(<Composer open onOpenChange={vi.fn()} accounts={accounts} accountsLoading={false} />);
    fireEvent.change(screen.getByLabelText(/^Caption/), { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByText('Paste media links instead'));
    fireEvent.change(screen.getByLabelText('Media links, one per line'), { target: { value: 'https://x.test/media/1-aaaaaaaa.jpg' } });
  };

  it('says "Submit for approval" and confirms the hand-off for a client that needs approval', async () => {
    h.me = clientMe(true);
    h.api.mockImplementation(async (path: string, opts?: { method?: string }) => (path === '/posts' && opts?.method === 'POST' ? { id: 'p', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' } : []));
    await fill();
    expect(screen.queryByRole('button', { name: /Schedule post/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Submit for approval/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Sent for approval. Your account manager will review it.', expect.anything()));
  });

  it('keeps "Schedule post" when the client does not need approval', async () => {
    h.me = clientMe(false);
    h.api.mockImplementation(async (path: string, opts?: { method?: string }) => (path === '/posts' && opts?.method === 'POST' ? { id: 'p', status: 'SCHEDULED' } : []));
    await fill();
    expect(screen.queryByRole('button', { name: /Submit for approval/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Schedule post/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Scheduled for/), expect.anything()));
  });

  it('is unchanged for staff, even when the client has the setting on', async () => {
    h.me = { ...staffMe, client: { id: 'c1', name: 'Acme', status: 'ACTIVE', requireApproval: true } };
    await fill();
    expect(screen.getByRole('button', { name: /Schedule post/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Submit for approval/ })).toBeNull();
  });
});

describe('PostDrawer approval states', () => {
  beforeEach(() => { h.api.mockReset(); h.api.mockResolvedValue({}); h.toast.success.mockReset(); h.me = clientMe(true); });
  const open = (p: Post) => { const onChanged = vi.fn(); const onOpenChange = vi.fn(); render(<PostDrawer post={p} onOpenChange={onOpenChange} onChanged={onChanged} />); return { onChanged, onOpenChange }; };

  it('awaiting approval: neutral label and an explanation, no scheduled pill', () => {
    open(post({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' }));
    expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0);
    expect(screen.queryByText('Scheduled')).toBeNull();
    expect(screen.getByText(/reviewing this post/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Resubmit' })).toBeNull();
  });

  it('approved and scheduled: positive label', () => {
    open(post({ status: 'SCHEDULED', approvalStatus: 'APPROVED' }));
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getByText(/Approved and scheduled/)).not.toBeNull();
  });

  it('a post without approval looks the same as before', () => {
    open(post({}));
    expect(screen.getByText('Scheduled')).not.toBeNull();
    expect(screen.queryByText(/approval/i)).toBeNull();
  });

  it('changes requested: quotes the note and resubmits with one click', async () => {
    const { onChanged, onOpenChange } = open(post({ status: 'PENDING_APPROVAL', approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Use the second photo' }));
    expect(screen.getAllByText('Changes requested').length).toBeGreaterThan(0);
    expect(screen.getByText('Use the second photo')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(h.api).toHaveBeenCalledWith('/posts/post1/resubmit', expect.objectContaining({ method: 'POST' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('"Edit and resubmit" saves through PATCH and closes', async () => {
    const { onChanged } = open(post({ status: 'PENDING_APPROVAL', approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Shorter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit and resubmit' }));
    fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'A shorter caption' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and resubmit' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = h.api.mock.calls.find((c) => c[0] === '/posts/post1')!;
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body).caption).toBe('A shorter caption');
    await act(async () => {});
  });

  it('staff looking at the same post get no client actions', () => {
    h.me = staffMe;
    open(post({ status: 'PENDING_APPROVAL', approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Shorter' }));
    expect(screen.queryByRole('button', { name: 'Resubmit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit and resubmit' })).toBeNull();
  });
});
