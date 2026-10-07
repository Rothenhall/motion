import type { Me } from '../lib/session';

/** A signed-in client user by default; pass overrides for staff, previews and switches. */
export const makeMe = (over: Partial<Me> = {}): Me => ({
  id: 'u1', email: 'client@acme.test', role: 'CLIENT_POC', client: { id: 'c1', name: 'Acme Bakery', status: 'ACTIVE' },
  features: {}, acting: false, readOnlyPreview: false, canActAs: false, ...over,
});

export const makeStaff = (over: Partial<Me> = {}): Me => makeMe({ id: 's1', email: 'staff@agency.test', role: 'ADMIN', canActAs: true, client: { id: 'home', name: 'Demo studio', status: 'ACTIVE' }, ...over });

/** Staff previewing Acme Bakery: read only ('view') or with admin controls ('admin'). */
export const makePreview = (mode: 'view' | 'admin', features: Record<string, boolean> = {}): Me =>
  makeStaff({ acting: true, readOnlyPreview: mode === 'view', client: { id: 'c1', name: 'Acme Bakery', status: 'ACTIVE' }, features });
