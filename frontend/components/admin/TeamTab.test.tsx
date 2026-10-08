import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { fakeApi } from './fake-api';
import TeamTab from './TeamTab';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: (await import('./fake-api')).fakeApi.api }));

const client: any = { id: 'c1', name: 'Bakery', seatLimit: 3, seatsUsed: 3 };
const member = (id: string, email: string, status: string, role = 'CLIENT_MEMBER', lastLoginAt: string | null = null) => ({ id, email, status, role, lastLoginAt, createdAt: '2026-01-01T00:00:00Z', hasPassword: status !== 'INVITED' });
const team = {
  members: [member('u1', 'boss@example.com', 'ACTIVE', 'CLIENT_POC', new Date(Date.now() - 3_600_000).toISOString()), member('u2', 'new@example.com', 'INVITED'), member('u3', 'gone@example.com', 'DISABLED')],
  seats: { used: 2, limit: 3 },
};
const link = { email: 'new@example.com', url: 'http://app.test/accept-invite?token=xyz', expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() };
const row = (email: string) => screen.getByText(email).closest('tr') as HTMLElement;

describe('Team tab', () => {
  beforeEach(() => {
    fakeApi.reset();
    fakeApi.on('GET', '/admin/clients/c1/users', () => team);
  });

  it('shows who is here, with only the actions that fit their status', async () => {
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('boss@example.com');
    expect(screen.getByText('2 of 3 seats used.')).not.toBeNull();
    expect(within(row('boss@example.com')).getByText('Main contact')).not.toBeNull();
    expect(within(row('boss@example.com')).queryByText('Resend invite')).toBeNull();
    expect(within(row('boss@example.com')).getByText('Reset link')).not.toBeNull();
    expect(within(row('new@example.com')).getByText('Resend invite')).not.toBeNull();
    expect(within(row('new@example.com')).queryByText('Reset link')).toBeNull();
    expect(within(row('gone@example.com')).getByText('Enable')).not.toBeNull();
    expect(within(row('new@example.com')).getByText('Never')).not.toBeNull();
  });

  it('resend invite shows the new link with the no-email wording', async () => {
    fakeApi.on('POST', '/admin/users/u2/resend-invite', { invite: link });
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('new@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Resend invite to new@example.com' }));
    await screen.findByText('New invite link for new@example.com');
    expect((screen.getByLabelText('Link') as HTMLInputElement).value).toBe(link.url);
    expect(screen.getByText('No email is sent. Copy this link and send it to new@example.com.')).not.toBeNull();
  });

  it('reset link works for active people', async () => {
    fakeApi.on('POST', '/admin/users/u1/reset-link', { reset: { ...link, email: 'boss@example.com' } });
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('boss@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Make a reset link for boss@example.com' }));
    await screen.findByText('Reset link for boss@example.com');
    expect(screen.getByText('No email is sent. Copy this link and send it to boss@example.com.')).not.toBeNull();
  });

  it('asks before disabling, then refreshes the list', async () => {
    fakeApi.on('POST', '/admin/users/u1/disable', member('u1', 'boss@example.com', 'DISABLED', 'CLIENT_POC'));
    const reload = vi.fn(async () => {});
    render(<TeamTab client={client} reload={reload} />);
    await screen.findByText('boss@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Disable boss@example.com' }));
    await screen.findByText('Disable boss@example.com?');
    expect(fakeApi.called('POST', '/admin/users/u1/disable')).toHaveLength(0); // nothing happened yet
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(fakeApi.called('POST', '/admin/users/u1/disable')).toHaveLength(1));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it('shows the seat-limit refusal when enabling someone with no seat free', async () => {
    fakeApi.on('POST', '/admin/users/u3/enable', new ApiError('There is no free seat. Raise the seat limit or remove someone first.', 400, 'SEAT_LIMIT'));
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('gone@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Enable gone@example.com' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('There is no free seat.'));
  });

  it('saves a new seat limit, and shows the server\'s answer when it is lower than what is in use', async () => {
    fakeApi.on('PATCH', '/admin/clients/c1/seats', (call: any) => (call.body.seatLimit < 2
      ? new ApiError('2 seats are in use. Remove people before lowering the limit below that.', 400, 'SEAT_LIMIT')
      : { ...client, seatLimit: call.body.seatLimit }));
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('boss@example.com');
    const input = screen.getByLabelText('Seat limit');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save seats' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('2 seats are in use.'));
    expect(fakeApi.called('PATCH', '/admin/clients/c1/seats')[0].body).toEqual({ seatLimit: 1 });

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save seats' }));
    await waitFor(() => expect(fakeApi.called('PATCH', '/admin/clients/c1/seats')).toHaveLength(2));
    expect(fakeApi.called('PATCH', '/admin/clients/c1/seats')[1].body).toEqual({ seatLimit: 5 });
  });

  it('invites a member and shows the link; a full workspace shows the server\'s words', async () => {
    fakeApi.on('POST', '/admin/clients/c1/invite', new ApiError('This workspace has used all 3 seats. Remove someone or ask your account manager for more.', 400, 'SEAT_LIMIT'));
    render(<TeamTab client={client} reload={async () => {}} />);
    await screen.findByText('boss@example.com');
    fireEvent.click(screen.getByRole('button', { name: /Invite member/ }));
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'fresh@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('used all 3 seats'));

    fakeApi.on('POST', '/admin/clients/c1/invite', { user: member('u9', 'fresh@example.com', 'INVITED'), invite: { ...link, email: 'fresh@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await screen.findByText('Invite link ready');
    expect(fakeApi.called('POST', '/admin/clients/c1/invite')[1].body).toEqual({ email: 'fresh@example.com', role: 'CLIENT_MEMBER' });
    expect(screen.getByText('No email is sent. Copy this link and send it to fresh@example.com.')).not.toBeNull();
  });
});
