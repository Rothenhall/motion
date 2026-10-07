/**
 * What an admin can switch on or off for a client. A key with no row in ClientFeatureFlag uses its default here, so
 * flags only ever record a deliberate change. Keep this list in step with section 8 of docs/admin-client-plan.md.
 */
export const FEATURE_KEYS = [
  // sections
  'planner',
  'content-lab',
  'preflight',
  'inbox',
  'automations',
  'analytics',
  // actions
  'compose', // create and edit drafts and posts, upload media
  'schedule', // schedule a post without approval
  'delete-posts',
  'inbox-reply',
  'edit-brand',
  'ai', // AI generation and the AI part of pre-flight; costs the agency money, so new clients start without it
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** For the admin screen: the switches that hide a whole section, and the ones that allow or block one action. */
export const SECTION_KEYS: FeatureKey[] = ['planner', 'content-lab', 'preflight', 'inbox', 'automations', 'analytics'];
export const ACTION_KEYS: FeatureKey[] = ['compose', 'schedule', 'delete-posts', 'inbox-reply', 'edit-brand', 'ai'];
export type FeatureMap = Record<FeatureKey, boolean>;

export const FEATURE_DEFAULTS: FeatureMap = {
  planner: true,
  'content-lab': true,
  preflight: true,
  inbox: true,
  automations: true,
  analytics: true,
  compose: true,
  schedule: true,
  'delete-posts': true,
  'inbox-reply': true,
  'edit-brand': true,
  ai: false,
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
