import type { AuditEntry } from '../../lib/admin';
import { providerLabel, roleLabel } from '../../lib/admin';
import { featureCopy } from './feature-copy';

export type ActivityFilter = 'all' | 'people' | 'channels' | 'features' | 'previews' | 'workspace';

export const ACTIVITY_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'channels', label: 'Channels' },
  { id: 'features', label: 'Features' },
  { id: 'previews', label: 'Previews' },
  { id: 'workspace', label: 'Workspace' },
];

/** Which group an audit action belongs to, from the part before the dot. */
export function groupOf(action: string): Exclude<ActivityFilter, 'all'> {
  const area = action.split('.')[0];
  if (area === 'user') return 'people';
  if (area === 'channel') return 'channels';
  if (area === 'feature') return 'features';
  if (area === 'preview') return 'previews';
  return 'workspace';
}

export const matchesFilter = (entry: AuditEntry, filter: ActivityFilter) => filter === 'all' || groupOf(entry.action) === filter;

const str = (value: unknown) => (typeof value === 'string' && value ? value : '');

/**
 * A sentence for one audit entry. `people` maps user ids to emails so "disabled <id>" can say who. Anything we do not know
 * about still reads as words, never as a raw code.
 */
export function describeActivity(entry: AuditEntry, people: Record<string, string> = {}): string {
  const who = entry.actor.email || 'Someone';
  const meta = (entry.meta ?? {}) as Record<string, unknown>;
  const target = (entry.targetId && people[entry.targetId]) || str(meta.email) || 'a person';

  switch (entry.action) {
    case 'client.create': return `${who} created this client${str(meta.name) ? ` (${str(meta.name)})` : ''}`;
    case 'client.update': {
      const parts: string[] = [];
      if (str(meta.name)) parts.push(`renamed the client to ${str(meta.name)}`);
      if ('notes' in meta) parts.push('updated the notes');
      if (typeof meta.requireApproval === 'boolean') parts.push(`turned approval ${meta.requireApproval ? 'on' : 'off'}`);
      return `${who} ${parts.join(' and ') || 'updated the client'}`;
    }
    case 'client.suspend': return `${who} suspended this client`;
    case 'client.activate': return `${who} activated this client`;
    case 'client.archive': return `${who} archived this client`;
    case 'client.unarchive': return `${who} restored this client from the archive`;
    case 'client.seats': return `${who} set the seat limit to ${typeof meta.seatLimit === 'number' ? meta.seatLimit : 'a new number'}`;
    case 'feature.set': return `${who} turned ${featureCopy(entry.targetId || 'a feature').label} ${meta.enabled === false ? 'off' : 'on'}`;
    case 'user.invite': return `${who} invited ${str(meta.email) || target}${str(meta.role) ? ` as ${roleLabel(str(meta.role)).toLowerCase()}` : ''}`;
    case 'user.resend_invite': return `${who} sent ${target} a new invite link`;
    case 'user.reset_link': return `${who} made a password reset link for ${target}`;
    case 'user.disable': return `${who} disabled ${target}`;
    case 'user.enable': return `${who} enabled ${target}`;
    case 'user.accept_invite': return `${who} accepted their invite and joined`;
    case 'user.reset_password': return `${who} set a new password`;
    case 'channel.connect': {
      const name = str(meta.label) || (str(meta.provider) ? providerLabel(str(meta.provider)) : '');
      return `${who} connected ${name ? `${name}` : 'a channel'}${meta.manual ? ' with a token' : ''}`;
    }
    case 'channel.disconnect': {
      const name = str(meta.provider) ? providerLabel(str(meta.provider)) : '';
      return `${who} disconnected ${name ? `${name === 'Instagram' ? 'an' : 'a'} ${name} channel` : 'a channel'}`;
    }
    case 'preview.start': return `${who} started previewing as this client (${meta.mode === 'admin' ? 'with admin controls' : 'read only'})`;
    case 'preview.exit': return `${who} stopped previewing as this client`;
    case 'approval.submit': return `${who} sent a post for approval`;
    case 'approval.resubmit': return `${who} sent a post back for approval`;
    case 'approval.approve': return `${who} approved a post`;
    case 'approval.request_changes': return `${who} asked for changes to a post${str(meta.note) ? `: ${str(meta.note)}` : ''}`;
    default: return `${who} did ${entry.action.replace(/[._]+/g, ' ')}`;
  }
}
