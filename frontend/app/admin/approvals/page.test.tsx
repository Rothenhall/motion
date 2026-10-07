import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '../../../test/approvals-fixtures';

const h = vi.hoisted(() => ({ api: vi.fn(), toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: h.api }));
vi.mock('sonner', () => ({ toast: h.toast }));

import { ApiError } from '@/lib/api';
import ApprovalsQueue from './page';

const future = (hours: number) => new Date(Date.now() + hours * 3_600_000);
const localInput = (d: Date) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const queue = [
  item({ id: 'p1', caption: 'Spring launch', client: { id: 'c1', name: 'Acme' } }),
  item({ id: 'p2', caption: 'Old promo', client: { id: 'c2', name: 'Birch' }, pastDue: true, scheduledAt: new Date(Date.now() - 3_600_000).toISOString(), approvalNote: 'Fix the date' }),
];
const serve = (items = queue) => h.api.mockImplementation(async (path: string) => {
  if (path === '/admin/approvals') return { items, total: items.length };
  return {};
});
const calls = (needle: string) => h.api.mock.calls.filter((c) => String(c[0]).includes(needle));
const card = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

describe('Approvals queue', () => {
  beforeEach(() => { h.api.mockReset(); Object.values(h.toast).forEach((f) => (f as any).mockReset?.()); h.toast.mockReset(); });

  it('shows skeletons, then cards with client link, time warning and earlier note', async () => {
    serve();
    render(<ApprovalsQueue />);
    expect(screen.getByLabelText('Loading approvals')).not.toBeNull();
    await screen.findByText('Spring launch');
    expect(screen.getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe('/admin/clients/c1');
    const late = card('Old promo');
    expect(within(late).getByText('Time has passed')).not.toBeNull();
    expect(within(late).getByText('Fix the date')).not.toBeNull();
    expect(within(late).getByText(/sam@acme.test/)).not.toBeNull();
    expect(within(late).getByRole('button', { name: 'Approve with a new time' })).not.toBeNull();
  });

  it('says so when nothing is waiting', async () => {
    serve([]);
    render(<ApprovalsQueue />);
    expect(await screen.findByText('Nothing is waiting for approval')).not.toBeNull();
  });

  it('shows an error with a retry', async () => {
    h.api.mockRejectedValueOnce(new Error('Server is down'));
    serve();
    render(<ApprovalsQueue />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Server is down/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Spring launch')).not.toBeNull();
  });

  it('filters by client', async () => {
    serve();
    render(<ApprovalsQueue />);
    await screen.findByText('Spring launch');
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter by client' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Birch' }));
    expect(screen.queryByText('Spring launch')).toBeNull();
    expect(screen.getByText('Old promo')).not.toBeNull();
  });

  it('approves at once when the time is still ahead, and removes the card', async () => {
    serve();
    render(<ApprovalsQueue />);
    await screen.findByText('Spring launch');
    fireEvent.click(within(card('Spring launch')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByText('Spring launch')).toBeNull());
    expect(calls('/approve')[0][0]).toBe('/admin/approvals/p1/approve');
    expect(JSON.parse(calls('/approve')[0][1].body)).toEqual({});
    expect(h.toast.success).toHaveBeenCalledWith('Approved', expect.anything());
  });

  it('asks for a new future time before approving a post whose time has passed', async () => {
    serve();
    render(<ApprovalsQueue />);
    await screen.findByText('Old promo');
    fireEvent.click(within(card('Old promo')).getByRole('button', { name: 'Approve with a new time' }));
    const dialog = await screen.findByRole('dialog');
    expect(calls('/approve')).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Publish on'), { target: { value: localInput(future(-2)) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve at this time' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Pick a time in the future.');
    expect(calls('/approve')).toHaveLength(0);

    const when = future(48);
    fireEvent.change(within(dialog).getByLabelText('Publish on'), { target: { value: localInput(when) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve at this time' }));
    await waitFor(() => expect(screen.queryByText('Old promo')).toBeNull());
    const sent = JSON.parse(calls('/approve')[0][1].body);
    expect(new Date(sent.scheduledAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('opens the time dialog when the server says the time passed meanwhile', async () => {
    serve();
    h.api.mockImplementation(async (path: string) => {
      if (path === '/admin/approvals') return { items: queue, total: 2 };
      throw new ApiError('late', 400, 'SCHEDULE_TIME_PASSED');
    });
    render(<ApprovalsQueue />);
    await screen.findByText('Spring launch');
    fireEvent.click(within(card('Spring launch')).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert').textContent).toMatch(/already passed/);
  });

  it('validates the note for requested changes (3 to 500 characters) and sends it', async () => {
    serve();
    render(<ApprovalsQueue />);
    await screen.findByText('Spring launch');
    fireEvent.click(within(card('Spring launch')).getByRole('button', { name: 'Request changes' }));
    const dialog = await screen.findByRole('dialog');
    const note = within(dialog).getByLabelText(/^Note/);

    fireEvent.change(note, { target: { value: 'ab' } });
    expect(within(dialog).getByText('2 / 500')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send note' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/at least 3/);

    fireEvent.change(note, { target: { value: 'x'.repeat(501) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send note' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/500 characters or fewer/);
    expect(calls('request-changes')).toHaveLength(0);

    fireEvent.change(note, { target: { value: '  Use the second photo.  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send note' }));
    await waitFor(() => expect(screen.queryByText('Spring launch')).toBeNull());
    expect(JSON.parse(calls('request-changes')[0][1].body)).toEqual({ note: 'Use the second photo.' });
  });

  it('handles a post someone else already decided: toast, then a fresh list', async () => {
    let first = true;
    h.api.mockImplementation(async (path: string) => {
      if (path === '/admin/approvals') { const items = first ? queue : [queue[1]]; first = false; return { items, total: items.length }; }
      throw new ApiError('conflict', 409, 'NOT_PENDING');
    });
    render(<ApprovalsQueue />);
    await screen.findByText('Spring launch');
    fireEvent.click(within(card('Spring launch')).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Already decided', expect.anything()));
    await waitFor(() => expect(screen.queryByText('Spring launch')).toBeNull());
    expect(screen.getByText('Old promo')).not.toBeNull();
    await act(async () => {});
  });
});
