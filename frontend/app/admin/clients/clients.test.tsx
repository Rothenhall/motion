import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../../../components/admin/fake-api';
import ClientsPage from './page';

vi.mock('../../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../../lib/api')>()), api: (await import('../../../components/admin/fake-api')).fakeApi.api }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1', name: 'Alpha Bakery', status: 'ACTIVE', archived: false, staffWorkspace: false, seatLimit: 3, seatsUsed: 2, pendingInvites: 1, notes: null,
  createdAt: '2026-01-01T00:00:00Z', channels: [{ id: 'a1', provider: 'instagram', name: '@alpha' }], disconnectedChannels: 0, scheduledPosts: 4, failedPosts: 2,
  lastActivityAt: new Date(Date.now() - 3_600_000).toISOString(), ...over,
});

describe('Clients list', () => {
  beforeEach(() => {
    fakeApi.reset();
    fakeApi.on('GET', '/admin/clients', [row(), row({ id: 'c2', name: 'Staff Home', staffWorkspace: true, channels: [], failedPosts: 0, lastActivityAt: null })]);
  });

  it('shows each client with status, channels, people, counts and last activity', async () => {
    render(<ClientsPage />);
    const link = await screen.findByRole('link', { name: 'Alpha Bakery' });
    expect(link.getAttribute('href')).toBe('/admin/clients/c1');
    const tr = link.closest('tr') as HTMLElement;
    expect(tr.textContent).toContain('Active');
    expect(tr.textContent).toContain('2 of 3');
    expect(tr.textContent).toContain('1 invited');
    expect(tr.textContent).toContain('1 hour ago');
    expect(screen.getByLabelText('Instagram, @alpha')).not.toBeNull();
    expect(screen.getByText('Staff workspace')).not.toBeNull();
    expect(screen.getByText('No activity yet')).not.toBeNull();
  });

  it('asks the server when you search or change the status filter', async () => {
    render(<ClientsPage />);
    await screen.findByRole('link', { name: 'Alpha Bakery' });
    fakeApi.on('GET', '/admin/clients?q=alp', [row()]);
    fireEvent.change(screen.getByLabelText('Search clients by name'), { target: { value: 'alp' } });
    await waitFor(() => expect(fakeApi.called('GET', '/admin/clients?q=alp')).toHaveLength(1));

    fakeApi.on('GET', '/admin/clients?q=alp&status=suspended', []);
    fireEvent.click(screen.getByRole('button', { name: 'Suspended' }));
    await waitFor(() => expect(fakeApi.called('GET', '/admin/clients?q=alp&status=suspended')).toHaveLength(1));
    await screen.findByText('No clients match');
    expect(screen.getByRole('button', { name: 'Suspended' }).getAttribute('aria-pressed')).toBe('true');

    fakeApi.on('GET', '/admin/clients?status=archived', []);
    fireEvent.change(screen.getByLabelText('Search clients by name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await waitFor(() => expect(fakeApi.called('GET', '/admin/clients?status=archived')).toHaveLength(1));
  });

  it('opens the New client dialog', async () => {
    render(<ClientsPage />);
    await screen.findByRole('link', { name: 'Alpha Bakery' });
    fireEvent.click(screen.getByRole('button', { name: /New client/ }));
    expect(await screen.findByLabelText('Main contact email')).not.toBeNull();
  });

  it('says so when the list cannot be loaded, and retries', async () => {
    fakeApi.reset();
    let fail = true;
    fakeApi.on('GET', '/admin/clients', () => (fail ? Object.assign(new Error('Request failed (500)'), { status: 500 }) : [row()]));
    render(<ClientsPage />);
    await screen.findByText('Request failed (500)');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('link', { name: 'Alpha Bakery' });
  });
});
