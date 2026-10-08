import { describe, expect, it } from 'vitest';
import { buildCommands, buildNav, canManageChannels, homePathFor, isActive, pageTitle } from './nav';
import type { Me } from './session';

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1', email: 'a@b.co', role: 'CLIENT_POC', client: { id: 'c1', name: 'Acme', status: 'ACTIVE' },
  features: {}, acting: false, readOnlyPreview: false, canActAs: false, ...over,
});
const staff = (over: Partial<Me> = {}) => me({ role: 'ADMIN', canActAs: true, ...over });
const hrefs = (m: Me | null) => buildNav(m).flatMap((g) => g.links.map((l) => l.href));
const labels = (m: Me | null) => buildNav(m).flatMap((g) => g.links.map((l) => l.label));

describe('buildNav', () => {
  it('has nothing until we know who this is', () => { expect(buildNav(null)).toEqual([]); });

  it('gives a client every section by default, with read-only Channels and no Connections or Admin', () => {
    expect(hrefs(me())).toEqual(['/', '/planner', '/lab', '/creators', '/preflight', '/comments', '/automations', '/analytics', '/connect']);
    expect(labels(me())).toContain('Channels');
    expect(labels(me())).not.toContain('Connections');
    expect(buildNav(me()).some((g) => g.id === 'admin')).toBe(false);
  });

  it.each([
    ['planner', '/planner'], ['content-lab', '/lab'], ['creators', '/creators'], ['preflight', '/preflight'],
    ['inbox', '/comments'], ['automations', '/automations'], ['analytics', '/analytics'],
  ])('hides %s for a client when it is switched off', (key, href) => {
    const list = hrefs(me({ features: { [key]: false } }));
    expect(list).not.toContain(href);
    expect(list).toContain('/');
    expect(list).toContain('/connect');
  });

  it('keeps Overview and Channels when everything is off, and ignores action switches and unknown keys', () => {
    const off = { planner: false, 'content-lab': false, creators: false, preflight: false, inbox: false, automations: false, analytics: false };
    expect(hrefs(me({ features: off }))).toEqual(['/', '/connect']);
    expect(hrefs(me({ features: { compose: false, ai: false, 'something-new': false } }))).toContain('/planner');
  });

  it('shows staff an Admin group first, then their own workspace with Connections', () => {
    const groups = buildNav(staff());
    expect(groups[0]).toMatchObject({ id: 'admin', label: 'Admin' });
    expect(groups[0].links.map((l) => l.href)).toEqual(['/admin', '/admin/clients', '/admin/approvals']);
    expect(labels(staff())).toContain('Connections');
    expect(hrefs(staff({ features: { planner: false } }))).toContain('/planner'); // staff are not held back by their own switches
  });

  it('shows acting staff the client menu, without Admin', () => {
    const view = staff({ acting: true, readOnlyPreview: true, features: { analytics: false, creators: false } });
    expect(buildNav(view).some((g) => g.id === 'admin')).toBe(false);
    expect(hrefs(view)).not.toContain('/analytics');
    expect(hrefs(view)).not.toContain('/creators');
    expect(labels(view)).toContain('Channels');
    expect(labels(view)).not.toContain('Connections');
  });

  it('shows staff with admin controls on everything, including Connections', () => {
    const admin = staff({ acting: true, readOnlyPreview: false, features: { analytics: false } });
    expect(hrefs(admin)).toContain('/analytics');
    expect(labels(admin)).toContain('Connections');
    expect(buildNav(admin).some((g) => g.id === 'admin')).toBe(false);
  });

  it('puts the approvals count on the Approvals link only when there is one', () => {
    const badge = (n?: number) => buildNav(staff(), { approvalsPending: n })[0].links.find((l) => l.label === 'Approvals')?.badge;
    expect(badge(4)).toBe(4);
    expect(badge()).toBeUndefined();
  });
});

describe('where things are', () => {
  it('knows who may manage channels and where people land', () => {
    expect(canManageChannels(staff())).toBe(true);
    expect(canManageChannels(staff({ acting: true, readOnlyPreview: true }))).toBe(false);
    expect(canManageChannels(me())).toBe(false);
    expect(homePathFor('ADMIN')).toBe('/admin');
    expect(homePathFor('CLIENT_POC')).toBe('/');
    expect(homePathFor('CLIENT_MEMBER')).toBe('/');
  });

  it('marks the current link, with Overview links matching exactly', () => {
    const adminHome = { href: '/admin', label: 'Overview', icon: 'shield' as const, exact: true };
    const clients = { href: '/admin/clients', label: 'Clients', icon: 'users' as const };
    expect(isActive(adminHome, '/admin/clients')).toBe(false);
    expect(isActive(clients, '/admin/clients/abc')).toBe(true);
    expect(isActive(clients, '/admin/clientsx')).toBe(false);
  });

  it('titles admin pages with the Admin eyebrow, and sub-pages like their section', () => {
    expect(pageTitle('/admin')).toEqual({ eyebrow: 'Admin', title: 'Overview' });
    expect(pageTitle('/admin/clients/abc')).toEqual({ eyebrow: 'Admin', title: 'Clients' });
    expect(pageTitle('/admin/approvals')).toEqual({ eyebrow: 'Admin', title: 'Approvals' });
    expect(pageTitle('/preflight/xyz').title).toBe('Pre-flight check');
    expect(pageTitle('/creators').title).toBe('Creators');
    expect(pageTitle('/nope').title).toBe('Page not found');
    expect(pageTitle('/connect', me()).title).toBe('Channels');
    expect(pageTitle('/connect', staff()).title).toBe('Connections');
  });
});

describe('buildCommands', () => {
  const ids = (m: Me | null) => { const c = buildCommands(m); return [...c.go, ...c.actions, ...c.admin].map((x) => x.id); };

  it('hides commands for switched-off sections and actions', () => {
    const list = ids(me({ features: { planner: false, creators: false, compose: false, ai: false } }));
    expect(list).not.toContain('pl');
    expect(list).not.toContain('cr');
    expect(list).not.toContain('new');
    expect(list).not.toContain('gen');
    expect(list).not.toContain('check');
    expect(list).toContain('an');
    expect(list).toContain('sync');
  });

  it('offers a client Channels instead of Connections, and no admin commands', () => {
    const c = buildCommands(me());
    expect(c.go.find((x) => x.id === 'co')?.label).toBe('Channels');
    expect(c.admin).toEqual([]);
  });

  it('adds admin commands for staff', () => {
    const c = buildCommands(staff());
    expect(c.go.find((x) => x.id === 'co')?.label).toBe('Connections');
    expect(c.admin.map((x) => x.href)).toEqual(['/admin', '/admin/clients', '/admin/approvals']);
  });
});
