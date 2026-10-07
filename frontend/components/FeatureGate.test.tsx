import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, makePreview } from '../test/fixtures';
import FeatureGate from './FeatureGate';
import { SessionProvider } from '../lib/session';

const h = vi.hoisted(() => ({ me: null as unknown }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: vi.fn(async () => h.me) }));

const show = async (me: unknown, feature: 'planner' | 'creators' = 'planner') => {
  h.me = me;
  window.localStorage.setItem('motion-session', 'token');
  render(<SessionProvider><FeatureGate feature={feature}><p>The planner page</p></FeatureGate></SessionProvider>);
};

describe('FeatureGate', () => {
  beforeEach(() => window.localStorage.clear());

  it('shows the section when its switch is on', async () => {
    await show(makeMe());
    expect(await screen.findByText('The planner page')).not.toBeNull();
  });

  it('shows the section when the switch is not known (a new switch never hides things by accident)', async () => {
    await show(makeMe({ features: {} }), 'creators');
    expect(await screen.findByText('The planner page')).not.toBeNull();
  });

  it('never shows a switched-off section, and points to the account manager and back to Overview', async () => {
    await show(makeMe({ features: { planner: false } }));
    expect(await screen.findByText('This is not switched on for your account')).not.toBeNull();
    expect(screen.queryByText('The planner page')).toBeNull();
    expect(screen.getByText(/Ask your account manager/)).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Overview' }).getAttribute('href')).toBe('/');
  });

  it('says it is what the client sees in a read-only preview', async () => {
    await show(makePreview('view', { planner: false }));
    expect(await screen.findByText(/This is what the client sees/)).not.toBeNull();
    expect(screen.getByText(/Acme Bakery does not have the Planner switched on/)).not.toBeNull();
    expect(screen.queryByText('The planner page')).toBeNull();
  });

  it('shows staff the section when they have admin controls on', async () => {
    await show(makePreview('admin', { planner: false }));
    expect(await screen.findByText('The planner page')).not.toBeNull();
  });
});
