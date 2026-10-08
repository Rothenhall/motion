import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe } from '../test/fixtures';
import Home from './page';
import { SessionProvider } from '../lib/session';

const h = vi.hoisted(() => ({ me: null as unknown, calls: [] as string[], broken: '', disabled: new Map<string, string>() }));
vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: vi.fn(async (path: string) => {
      h.calls.push(path);
      const off = [...h.disabled.keys()].find((p) => path.startsWith(p));
      if (h.broken && path.startsWith(h.broken)) throw new real.ApiError('The server is down.', 500);
      if (off) throw new real.ApiError('Not switched on.', 403, 'FEATURE_DISABLED', h.disabled.get(off));
      if (path === '/auth/me') return h.me;
      if (path === '/dashboard') return { stats: { scheduled: 0, published: 0, failed: 0 }, upcomingPosts: [], accounts: [], automationCount: 0, activeAutomationCount: 0 };
      if (path === '/analytics?days=30') return { hasInsights: false, series: [], totals: { views: 0, viewsChange: null, engagementRate: null, engagementRateChange: null, engagements: 0 }, topPosts: [] };
      return [];
    }),
  };
});

const show = (me: unknown) => {
  h.me = me;
  window.localStorage.setItem('motion-session', 'token');
  render(<SessionProvider><Home /></SessionProvider>);
};

describe('Overview with some sections switched off', () => {
  beforeEach(() => { window.localStorage.clear(); h.calls.length = 0; h.broken = ''; h.disabled.clear(); });

  it('shows every widget when everything is on', async () => {
    show(makeMe());
    expect(await screen.findByText('Views · last 30 days')).not.toBeNull();
    expect(screen.getByText('This week')).not.toBeNull();
    expect(screen.getByText('Up next')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Create post/ })).not.toBeNull();
  });

  it('survives one widget coming back FEATURE_DISABLED: that widget goes, the rest still works', async () => {
    h.disabled.set('/analytics', 'analytics');
    show(makeMe());
    await waitFor(() => expect(screen.queryByText('Views · last 30 days')).toBeNull());
    expect(screen.getByText('This week')).not.toBeNull();
    expect(screen.getByText('Up next')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('survives the planner list coming back FEATURE_DISABLED', async () => {
    h.disabled.set('/posts', 'planner');
    show(makeMe());
    await waitFor(() => expect(screen.queryByText('This week')).toBeNull());
    expect(screen.getByText('Views · last 30 days')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the widgets of switched-off sections without asking the server for them', async () => {
    show(makeMe({ features: { planner: false, analytics: false, automations: false, compose: false } }));
    expect(await screen.findByRole('heading', { level: 1 })).not.toBeNull();
    await waitFor(() => expect(h.calls).toContain('/dashboard'));
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.queryByText('Up next')).toBeNull();
    expect(screen.queryByText('Views · last 30 days')).toBeNull();
    expect(screen.queryByText('What worked lately')).toBeNull();
    expect(screen.queryByText('Automations')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create post/ })).toBeNull();
    expect(screen.getByText('Channels')).not.toBeNull();
    expect(h.calls).not.toContain('/posts');
    expect(h.calls).not.toContain('/drafts');
    expect(h.calls.some((c) => c.startsWith('/analytics'))).toBe(false);
  });

  it('still reports a real failure', async () => {
    h.broken = '/dashboard';
    show(makeMe());
    expect((await screen.findByRole('alert')).textContent).toContain('The server is down.');
  });
});
