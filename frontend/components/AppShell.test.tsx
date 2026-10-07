import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, makePreview, makeStaff } from '../test/fixtures';
import AppShell from './AppShell';
import { ApiError } from '../lib/api';
import { SessionProvider } from '../lib/session';
import { TooltipProvider } from '@/components/ui/tooltip';

const h = vi.hoisted(() => ({ path: '/', me: null as unknown, meError: null as unknown, signOut: vi.fn(), pending: false }));
vi.mock('next/navigation', () => ({ usePathname: () => h.path, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  signOut: h.signOut,
  api: vi.fn(async (path: string) => {
    if (path === '/auth/me') {
      if (h.pending) return new Promise(() => {});
      if (h.meError) throw h.meError;
      return h.me;
    }
    return [];
  }),
}));

const show = (path = '/') => {
  h.path = path;
  return render(<SessionProvider><TooltipProvider><AppShell><p>Page body</p></AppShell></TooltipProvider></SessionProvider>);
};
const nav = () => screen.getAllByRole('navigation', { name: 'Main navigation' })[0];

describe('AppShell', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('motion-session', 'token');
    h.me = null; h.meError = null; h.pending = false; h.signOut.mockReset();
  });

  it('shows a calm skeleton while it asks who you are, with no menu and no page', () => {
    h.pending = true;
    const { container } = show();
    expect(container.querySelector('.shell-skeleton')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(screen.queryByText('Page body')).toBeNull();
  });

  it('shows a client only the sections that are on, with Channels and no Connections or Admin', async () => {
    h.me = makeMe({ features: { analytics: false, creators: false } });
    show();
    expect(await screen.findByText('Page body')).not.toBeNull();
    const menu = within(nav());
    expect(menu.getByRole('link', { name: 'Planner' })).not.toBeNull();
    expect(menu.queryByRole('link', { name: 'Analytics' })).toBeNull();
    expect(menu.queryByRole('link', { name: 'Creators' })).toBeNull();
    expect(menu.getByRole('link', { name: 'Channels' })).not.toBeNull();
    expect(menu.queryByRole('link', { name: 'Connections' })).toBeNull();
    expect(menu.queryByText('Admin')).toBeNull();
  });

  it('shows staff the Admin group and their own workspace menu, and their email', async () => {
    h.me = makeStaff();
    show();
    await screen.findByText('Page body');
    const menu = within(nav());
    expect(menu.getByRole('link', { name: 'Clients' }).getAttribute('href')).toBe('/admin/clients');
    expect(menu.getByRole('link', { name: 'Approvals' }).getAttribute('href')).toBe('/admin/approvals');
    expect(menu.getByRole('link', { name: 'Connections' })).not.toBeNull();
    expect(screen.getAllByText('staff@agency.test').length).toBeGreaterThan(0);
  });

  it('marks the current page and titles admin pages with the Admin eyebrow', async () => {
    h.me = makeStaff();
    show('/admin/clients/abc');
    await screen.findByText('Page body');
    expect(within(nav()).getByRole('link', { name: 'Clients' }).getAttribute('aria-current')).toBe('page');
    const overviews = within(nav()).getAllByRole('link', { name: 'Overview' });
    expect(overviews.map((l) => l.getAttribute('aria-current'))).toEqual([null, null]); // Overview links match exactly, so neither is marked
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Admin');
  });

  it('shows the preview bar and the client menu while staff preview a client', async () => {
    h.me = makePreview('view', { planner: false });
    show();
    expect(await screen.findByText('Previewing Acme Bakery')).not.toBeNull();
    expect(within(nav()).queryByRole('link', { name: 'Planner' })).toBeNull();
    expect(within(nav()).queryByRole('link', { name: 'Clients' })).toBeNull();
  });

  it('shows a full-page paused screen with Sign out when the workspace is suspended', async () => {
    h.meError = new ApiError('This workspace is paused. Contact your account manager.', 403, 'CLIENT_SUSPENDED');
    show();
    expect(await screen.findByText('This workspace is paused')).not.toBeNull();
    expect(screen.getByText('Contact your account manager.')).not.toBeNull();
    expect(screen.queryByText('Page body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(h.signOut).toHaveBeenCalled();
  });

  it('shows a retry card when the server cannot be reached, and loads again on retry', async () => {
    h.meError = new ApiError('Request failed (500)', 500);
    show();
    expect(await screen.findByText('Could not reach Motion')).not.toBeNull();
    h.meError = null; h.me = makeMe();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Page body')).not.toBeNull();
  });

  it('sends people without a session to sign in', async () => {
    window.localStorage.clear();
    show();
    await vi.waitFor(() => expect(h.signOut).toHaveBeenCalled());
    expect(screen.queryByText('Page body')).toBeNull();
  });

  it.each(['/login', '/accept-invite', '/reset-password'])('renders %s without a session', (path) => {
    window.localStorage.clear();
    show(path);
    expect(screen.getByText('Page body')).not.toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
