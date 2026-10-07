import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '../../test/approvals-fixtures';

const h = vi.hoisted(() => ({ api: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: h.api }));
vi.mock('sonner', () => ({ toast: h.toast }));

import ApprovalsTab from './ApprovalsTab';
import RequireApprovalToggle from './RequireApprovalToggle';

describe('ApprovalsTab', () => {
  beforeEach(() => { h.api.mockReset(); });

  it('lists pending posts without a client column, and decided ones in a collapsed section', async () => {
    h.api.mockResolvedValue({
      pending: [item({ id: 'p1', caption: 'Waiting post' })],
      recent: [
        item({ id: 'r1', caption: 'Went live', approvalStatus: 'APPROVED', approvalDecidedAt: new Date().toISOString() }),
        item({ id: 'r2', caption: 'Sent back', approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Shorter caption', approvalDecidedAt: new Date().toISOString() }),
      ],
    });
    render(<ApprovalsTab clientId="c1" />);
    expect(screen.getByLabelText('Loading approvals')).not.toBeNull();
    await screen.findByText('Waiting post');
    expect(h.api).toHaveBeenCalledWith('/admin/clients/c1/approvals');
    expect(screen.queryByRole('link', { name: 'Acme' })).toBeNull();

    const details = screen.getByText('Recently decided (2)').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(within(details).getByText('Approved')).not.toBeNull();
    expect(within(details).getByText('Changes requested')).not.toBeNull();
    expect(within(details).getByText('Shorter caption')).not.toBeNull();
    expect(within(details).queryByRole('button', { name: 'Approve' })).toBeNull(); // decided items have no actions
  });

  it('shows the empty state and omits the recent section when there is nothing', async () => {
    h.api.mockResolvedValue({ pending: [], recent: [] });
    render(<ApprovalsTab clientId="c1" />);
    expect(await screen.findByText('Nothing is waiting for approval')).not.toBeNull();
    expect(screen.queryByText(/Recently decided/)).toBeNull();
  });

  it('shows an error and retries', async () => {
    h.api.mockRejectedValueOnce(new Error('nope')).mockResolvedValue({ pending: [], recent: [] });
    render(<ApprovalsTab clientId="c1" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/nope/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing is waiting for approval')).not.toBeNull();
  });
});

describe('RequireApprovalToggle', () => {
  beforeEach(() => { h.api.mockReset(); h.api.mockResolvedValue({}); h.toast.error.mockReset(); });

  it('explains itself and saves the new value', async () => {
    const onChange = vi.fn();
    render(<RequireApprovalToggle clientId="c1" value={false} onChange={onChange} />);
    expect(screen.getByText("New posts from this client's people wait here for your approval before they are scheduled. Staff posts are never held.")).not.toBeNull();
    const sw = screen.getByRole('switch', { name: 'Require approval' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    expect(h.api).toHaveBeenCalledWith('/admin/clients/c1', expect.objectContaining({ method: 'PATCH', body: '{"requireApproval":true}' }));
    expect(sw.getAttribute('aria-checked')).toBe('true');
  });

  it('puts the switch back and says so when saving fails', async () => {
    h.api.mockRejectedValue(new Error('Could not save'));
    const onChange = vi.fn();
    render(<RequireApprovalToggle clientId="c1" value onChange={onChange} />);
    const sw = screen.getByRole('switch');
    fireEvent.click(sw);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Could not save'));
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });
});
