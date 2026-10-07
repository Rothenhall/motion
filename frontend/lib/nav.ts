import type { Icon } from '../components/Icons';
import { featureOn, isStaff, type FeatureKey, type Me, type Role } from './session';

type BaseIcon = Parameters<typeof Icon>[0]['name'];
export type NavIconName = BaseIcon | 'users' | 'shield';

export interface NavLink {
  href: string;
  label: string;
  icon: NavIconName;
  /** Only the exact address counts as "here" (Overview pages). */
  exact?: boolean;
  /** A small count shown beside the label. Hidden when 0 or missing. */
  badge?: number;
}
export interface NavGroup { id: string; label: string; links: NavLink[] }

/** Extra numbers the shell can pass in. */
export interface NavExtras {
  /** APPROVALS-BADGE: the number of posts waiting for approval. Another stream supplies it; the badge shows when above 0. */
  approvalsPending?: number;
}

export const FEATURE_LABELS: Record<string, string> = {
  planner: 'the Planner',
  'content-lab': 'Content Lab',
  creators: 'Creators',
  preflight: 'Pre-flight check',
  inbox: 'the Inbox',
  automations: 'Automations',
  analytics: 'Analytics',
};

interface WorkspaceItem {
  id: string;
  href: string;
  label: string;
  icon: NavIconName;
  group: 'Studio' | 'Engage' | 'Measure';
  feature?: FeatureKey;
  hint: string;
  keywords?: string[];
  /** false: a palette command only, not a menu entry. */
  nav?: boolean;
}

const ITEMS: WorkspaceItem[] = [
  { id: 'ov', href: '/', label: 'Overview', icon: 'grid', group: 'Studio', hint: 'Workspace', keywords: ['home', 'dashboard'] },
  { id: 'pl', href: '/planner', label: 'Planner', icon: 'calendar', group: 'Studio', feature: 'planner', hint: 'Calendar', keywords: ['schedule', 'calendar'] },
  { id: 'lab', href: '/lab', label: 'Content Lab', icon: 'bulb', group: 'Studio', feature: 'content-lab', hint: 'Ideas and hooks', keywords: ['ideas', 'hooks', 'board'] },
  { id: 'hk', href: '/lab?view=hooks', label: 'Hook library', icon: 'sparkles', group: 'Studio', feature: 'content-lab', hint: 'Opening lines', nav: false },
  { id: 'cr', href: '/creators', label: 'Creators', icon: 'search', group: 'Studio', feature: 'creators', hint: 'Find and study creators', keywords: ['influencers', 'research'] },
  { id: 'pf', href: '/preflight', label: 'Pre-flight check', icon: 'gauge', group: 'Studio', feature: 'preflight', hint: 'Predict reactions before posting', keywords: ['predict', 'review', 'check'] },
  { id: 'in', href: '/comments', label: 'Inbox', icon: 'inbox', group: 'Engage', feature: 'inbox', hint: 'Comments', keywords: ['comments', 'reply'] },
  { id: 'au', href: '/automations', label: 'Automations', icon: 'zap', group: 'Engage', feature: 'automations', hint: 'Comment to DM', keywords: ['rules', 'dm'] },
  { id: 'an', href: '/analytics', label: 'Analytics', icon: 'chart', group: 'Measure', feature: 'analytics', hint: 'Reports', keywords: ['stats', 'insights'] },
];

/** Staff can manage channels unless they are in a read-only preview, where they see what the client sees. */
export const canManageChannels = (me: Me | null | undefined) => isStaff(me) && !me?.readOnlyPreview;

/** Where each kind of person lands after signing in. */
export const homePathFor = (role: Role | string | undefined) => (role === 'ADMIN' ? '/admin' : '/');

const visible = (me: Me, item: WorkspaceItem) => !item.feature || featureOn(me, item.feature);

/** The menu for this person. Pure, so every role and switch combination can be tested. */
export function buildNav(me: Me | null | undefined, extras: NavExtras = {}): NavGroup[] {
  if (!me) return [];
  const groups: NavGroup[] = [];

  if (isStaff(me) && !me.acting) {
    groups.push({
      id: 'admin', label: 'Admin', links: [
        { href: '/admin', label: 'Overview', icon: 'shield', exact: true },
        { href: '/admin/clients', label: 'Clients', icon: 'users' },
        { href: '/admin/approvals', label: 'Approvals', icon: 'check', badge: extras.approvalsPending },
      ],
    });
  }

  for (const name of ['Studio', 'Engage', 'Measure'] as const) {
    const links: NavLink[] = ITEMS.filter((i) => i.nav !== false && i.group === name && visible(me, i)).map((i) => ({ href: i.href, label: i.label, icon: i.icon, exact: i.href === '/' }));
    if (name === 'Measure') links.push(canManageChannels(me) ? { href: '/connect', label: 'Connections', icon: 'link' } : { href: '/connect', label: 'Channels', icon: 'link' });
    groups.push({ id: name.toLowerCase(), label: name, links });
  }
  return groups;
}

export const isActive = (link: NavLink, pathname: string) => (link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`));

const ADMIN_TITLES: [string, string][] = [['/admin/approvals', 'Approvals'], ['/admin/clients', 'Clients'], ['/admin', 'Overview']];
const TITLES: Record<string, { eyebrow: string; title: string }> = {
  '/': { eyebrow: 'Studio', title: 'Overview' },
  '/planner': { eyebrow: 'Studio', title: 'Planner' },
  '/lab': { eyebrow: 'Studio', title: 'Content Lab' },
  '/ideas': { eyebrow: 'Studio', title: 'Content Lab' }, // these two only redirect to /lab
  '/hooks': { eyebrow: 'Studio', title: 'Content Lab' },
  '/creators': { eyebrow: 'Studio', title: 'Creators' },
  '/preflight': { eyebrow: 'Studio', title: 'Pre-flight check' },
  '/automations': { eyebrow: 'Engage', title: 'Automations' },
  '/comments': { eyebrow: 'Engage', title: 'Inbox' },
  '/analytics': { eyebrow: 'Measure', title: 'Analytics' },
};

/** Breadcrumb and tab title for an address. Sub-pages share their section's title. */
export function pageTitle(pathname: string, me?: Me | null): { eyebrow: string; title: string } {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const hit = ADMIN_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return { eyebrow: 'Admin', title: hit ? hit[1] : 'Overview' };
  }
  if (pathname === '/connect') return { eyebrow: 'Measure', title: canManageChannels(me) ? 'Connections' : 'Channels' };
  return TITLES[pathname] || TITLES[`/${pathname.split('/')[1]}`] || { eyebrow: 'Motion', title: 'Page not found' };
}

export interface PaletteCommand { id: string; label: string; hint: string; href: string; icon: NavIconName; keywords?: string[] }

/** Palette commands for this person: the same switches as the menu, plus admin shortcuts for staff. */
export function buildCommands(me: Me | null | undefined): { go: PaletteCommand[]; actions: PaletteCommand[]; admin: PaletteCommand[] } {
  if (!me) return { go: [], actions: [], admin: [] };
  const go: PaletteCommand[] = ITEMS.filter((i) => visible(me, i)).map((i) => ({ id: i.id, label: i.label, hint: i.hint, href: i.href, icon: i.icon, keywords: i.keywords }));
  go.push(canManageChannels(me)
    ? { id: 'co', label: 'Connections', hint: 'Channels', href: '/connect', icon: 'link', keywords: ['instagram', 'facebook', 'threads'] }
    : { id: 'co', label: 'Channels', hint: 'Connected channels', href: '/connect', icon: 'link', keywords: ['instagram', 'facebook', 'threads'] });

  const actions: PaletteCommand[] = [];
  if (featureOn(me, 'compose')) actions.push({ id: 'new', label: 'Create post', hint: 'Composer', href: '/?compose=true', icon: 'plus', keywords: ['new', 'schedule', 'compose'] });
  if (featureOn(me, 'content-lab') && featureOn(me, 'ai')) actions.push({ id: 'gen', label: 'Generate ideas', hint: 'Content Lab', href: '/lab', icon: 'sparkles', keywords: ['write', 'ideas'] });
  if (featureOn(me, 'preflight') && featureOn(me, 'ai')) actions.push({ id: 'check', label: 'Check a reel', hint: 'Pre-flight', href: '/preflight', icon: 'gauge', keywords: ['predict', 'reel', 'preflight'] });
  if (featureOn(me, 'analytics')) actions.push({ id: 'sync', label: 'Sync insights', hint: 'Analytics', href: '/analytics', icon: 'refresh', keywords: ['refresh', 'meta'] });

  const admin: PaletteCommand[] = isStaff(me)
    ? [
      { id: 'ad-ov', label: 'Admin overview', hint: 'Admin', href: '/admin', icon: 'shield', keywords: ['staff', 'agency'] },
      { id: 'ad-cl', label: 'Clients', hint: 'Admin', href: '/admin/clients', icon: 'users', keywords: ['accounts', 'workspaces'] },
      { id: 'ad-ap', label: 'Approvals', hint: 'Admin', href: '/admin/approvals', icon: 'check', keywords: ['review', 'pending'] },
    ]
    : [];
  return { go, actions, admin };
}
