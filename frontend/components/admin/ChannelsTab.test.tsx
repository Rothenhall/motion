import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import ChannelsTab from './ChannelsTab';
import { fakeApi } from './fake-api';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: (await import('./fake-api')).fakeApi.api }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/admin/clients/c1',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const client: any = { id: 'c1', name: 'Bakery' };
const channels = [
  { id: 'a1', provider: 'instagram', name: '@bakery', externalId: 'ig-1', connected: true, connectedAt: '2026-01-01T00:00:00Z', disconnectedAt: null, tokenExpires: new Date(Date.now() + 5 * 86_400_000).toISOString(), insightsSyncedAt: null, insightsError: 'Token rejected' },
  { id: 'a2', provider: 'facebook_page', name: 'Bakery Page', externalId: 'fb-1', connected: false, connectedAt: '2026-01-01T00:00:00Z', disconnectedAt: '2026-02-01T00:00:00Z', tokenExpires: null, insightsSyncedAt: null, insightsError: null },
];

describe('Channels tab', () => {
  beforeEach(() => {
    fakeApi.reset();
    nav.replace.mockClear();
    nav.search = '';
    toasts.success.mockClear();
    toasts.error.mockClear();
    fakeApi.on('GET', '/admin/clients/c1/channels', channels);
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
  });

  it('lists channels with their state, token expiry and the last sync error', async () => {
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await screen.findByText('@bakery');
    expect(screen.getByText('Connected')).not.toBeNull();
    expect(screen.getByText('Disconnected')).not.toBeNull();
    expect(screen.getByText(/Token expires in/)).not.toBeNull();
    expect(screen.getByText('Last sync failed: Token rejected')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect @bakery' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reconnect Bakery Page' })).not.toBeNull();
  });

  it('starts connecting for this client by naming it in the X-Client-Id header, then goes to the platform', async () => {
    fakeApi.on('GET', '/auth/instagram/start', { url: 'https://www.instagram.com/oauth/authorize?x=1' });
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await screen.findByText('@bakery');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Instagram' }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://www.instagram.com/oauth/authorize?x=1'));
    expect(fakeApi.called('GET', '/auth/instagram/start')[0].headers).toMatchObject({ 'X-Client-Id': 'c1' });
  });

  it('reconnecting a Facebook page uses the facebook connect route', async () => {
    fakeApi.on('GET', '/auth/facebook/start', { url: 'https://www.facebook.com/dialog' });
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await screen.findByText('Bakery Page');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Bakery Page' }));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledWith('https://www.facebook.com/dialog'));
    expect(fakeApi.called('GET', '/auth/facebook/start')[0].headers).toMatchObject({ 'X-Client-Id': 'c1' });
  });

  it('disconnects after a confirm, with the same header', async () => {
    fakeApi.on('DELETE', '/accounts/a1', { id: 'a1' });
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await screen.findByText('@bakery');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect @bakery' }));
    await screen.findByText('Disconnect @bakery?');
    expect(fakeApi.called('DELETE', '/accounts/a1')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^Disconnect$/ }));
    await waitFor(() => expect(fakeApi.called('DELETE', '/accounts/a1')).toHaveLength(1));
    expect(fakeApi.called('DELETE', '/accounts/a1')[0].headers).toMatchObject({ 'X-Client-Id': 'c1' });
  });

  it('adds a channel from a token and shows a clear message when another client already has it', async () => {
    fakeApi.on('POST', '/accounts', new ApiError('This channel is already connected to Other Co. Disconnect it there first.', 409, 'CHANNEL_ALREADY_CONNECTED'));
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await screen.findByText('@bakery');
    fireEvent.change(screen.getByLabelText('Account ID'), { target: { value: 'ig-9' } });
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'test-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('already connected to Other Co'));
    const call = fakeApi.called('POST', '/accounts')[0];
    expect(call.headers).toMatchObject({ 'X-Client-Id': 'c1' });
    expect(call.body).toMatchObject({ provider: 'instagram', externalId: 'ig-9', accessToken: 'test-token' });
  });

  it('reads the result Meta sent back, tells the person, and cleans the address', async () => {
    nav.search = 'tab=channels&connected=instagram&account=%40bakery';
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('@bakery connected'));
    expect(nav.replace).toHaveBeenCalledWith('/admin/clients/c1?tab=channels', { scroll: false });
  });

  it('shows a connection error from the address in the page, then cleans it', async () => {
    nav.search = 'tab=channels&error=Instagram%20authorization%20was%20cancelled.';
    render(<ChannelsTab client={client} reload={async () => {}} />);
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('Instagram authorization was cancelled.'));
    expect(nav.replace).toHaveBeenCalledWith('/admin/clients/c1?tab=channels', { scroll: false });
  });
});
