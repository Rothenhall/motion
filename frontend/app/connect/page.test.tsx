import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, makePreview, makeStaff } from '../../test/fixtures';
import Connect from './page';
import { SessionProvider } from '../../lib/session';
import { expiryWarning } from '../../lib/channels';

const h = vi.hoisted(() => ({ me: null as unknown, accounts: [] as unknown[] }));
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  api: vi.fn(async (path: string) => (path === '/auth/me' ? h.me : path === '/accounts' ? h.accounts : null)),
}));

const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
const accounts = [
  { id: 'a1', provider: 'instagram', externalId: 'ig1', name: 'Acme IG', createdAt: new Date().toISOString(), tokenExpires: null },
  { id: 'a2', provider: 'facebook_page', externalId: 'fb1', name: 'Acme Page', createdAt: new Date().toISOString(), tokenExpires: soon },
];

const show = (me: unknown) => {
  h.me = me; h.accounts = accounts;
  window.localStorage.setItem('motion-session', 'token');
  render(<SessionProvider><Connect /></SessionProvider>);
};

describe('Connect page', () => {
  beforeEach(() => window.localStorage.clear());

  it('is a read-only list for a client: channels, a warning, and no way to connect or disconnect', async () => {
    show(makeMe());
    expect(await screen.findByText('Acme IG')).not.toBeNull();
    expect(screen.getByText(/Channels are connected and managed by your agency. To add or change one, contact your account manager./)).not.toBeNull();
    expect(screen.getByText(/Expires in 2 days/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Disconnect/ })).toBeNull();
  });

  it('shows the same read-only list to staff in a view-as-client preview', async () => {
    show(makePreview('view'));
    expect(await screen.findByText('Acme IG')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Connect Instagram/ })).toBeNull();
  });

  it('is the full page for staff, with connect and disconnect', async () => {
    show(makeStaff());
    expect(await screen.findByText('Bring your channels together')).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Disconnect Acme IG' })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Connect Threads/ })).not.toBeNull();
  });

  it('is the full page for staff with admin controls on', async () => {
    show(makePreview('admin'));
    expect(await screen.findByText('Bring your channels together')).not.toBeNull();
  });
});

describe('expiryWarning', () => {
  const now = Date.parse('2026-10-07T00:00:00Z');
  it('warns inside a week, and when already expired', () => {
    expect(expiryWarning(null, now)).toBeNull();
    expect(expiryWarning('2026-12-01T00:00:00Z', now)).toBeNull();
    expect(expiryWarning('2026-10-10T00:00:00Z', now)).toBe('Expires in 3 days');
    expect(expiryWarning('2026-10-07T06:00:00Z', now)).toBe('Expires in 1 day');
    expect(expiryWarning('2026-10-01T00:00:00Z', now)).toBe('Needs reconnecting');
  });
});
