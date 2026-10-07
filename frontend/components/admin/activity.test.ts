import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../../lib/admin';
import { describeActivity, groupOf, matchesFilter } from './activity';

const entry = (action: string, over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: action, at: '2026-01-01T00:00:00Z', action, targetType: null, targetId: null, meta: null, actor: { id: 'a', email: 'ana@rothenhall.test' }, ...over,
});
const people = { u1: 'sam@example.com' };

describe('activity sentences', () => {
  it('says who did what to whom', () => {
    expect(describeActivity(entry('user.disable', { targetType: 'user', targetId: 'u1' }), people)).toBe('ana@rothenhall.test disabled sam@example.com');
    expect(describeActivity(entry('user.enable', { targetId: 'u1' }), people)).toBe('ana@rothenhall.test enabled sam@example.com');
    expect(describeActivity(entry('user.invite', { meta: { email: 'kim@example.com', role: 'CLIENT_MEMBER' } }))).toBe('ana@rothenhall.test invited kim@example.com as member');
    expect(describeActivity(entry('user.reset_link', { targetId: 'u1' }), people)).toBe('ana@rothenhall.test made a password reset link for sam@example.com');
  });

  it('names switches in words, with on or off', () => {
    expect(describeActivity(entry('feature.set', { targetId: 'planner', meta: { enabled: false } }))).toBe('ana@rothenhall.test turned Planner off');
    expect(describeActivity(entry('feature.set', { targetId: 'ai', meta: { enabled: true } }))).toBe('ana@rothenhall.test turned AI tools on');
    expect(describeActivity(entry('feature.set', { targetId: 'creators', meta: { enabled: true } }))).toBe('ana@rothenhall.test turned Creators on');
  });

  it('covers channels, previews, the workspace and approvals', () => {
    expect(describeActivity(entry('channel.connect', { meta: { provider: 'instagram', label: '@bakery' } }))).toBe('ana@rothenhall.test connected @bakery');
    expect(describeActivity(entry('channel.connect', { meta: { provider: 'threads', manual: true } }))).toBe('ana@rothenhall.test connected Threads with a token');
    expect(describeActivity(entry('channel.disconnect', { meta: { provider: 'facebook_page' } }))).toBe('ana@rothenhall.test disconnected a Facebook channel');
    expect(describeActivity(entry('channel.disconnect', { meta: { provider: 'instagram' } }))).toBe('ana@rothenhall.test disconnected an Instagram channel');
    expect(describeActivity(entry('preview.start', { meta: { mode: 'admin' } }))).toBe('ana@rothenhall.test started previewing as this client (with admin controls)');
    expect(describeActivity(entry('preview.start', { meta: { mode: 'view' } }))).toContain('read only');
    expect(describeActivity(entry('client.seats', { meta: { seatLimit: 5 } }))).toBe('ana@rothenhall.test set the seat limit to 5');
    expect(describeActivity(entry('client.update', { meta: { name: 'New Name' } }))).toBe('ana@rothenhall.test renamed the client to New Name');
    expect(describeActivity(entry('client.suspend'))).toBe('ana@rothenhall.test suspended this client');
    expect(describeActivity(entry('approval.approve'))).toBe('ana@rothenhall.test approved a post');
  });

  it('never shows a raw code or crashes on something new', () => {
    expect(describeActivity(entry('thing.did_a_new_thing', { actor: { id: 'x', email: null } }))).toBe('Someone did thing did a new thing');
    expect(describeActivity(entry('user.disable', { targetId: 'gone' }), people)).toBe('ana@rothenhall.test disabled a person');
  });

  it('groups actions for the filter', () => {
    expect(groupOf('user.disable')).toBe('people');
    expect(groupOf('channel.connect')).toBe('channels');
    expect(groupOf('feature.set')).toBe('features');
    expect(groupOf('preview.exit')).toBe('previews');
    expect(groupOf('client.archive')).toBe('workspace');
    expect(matchesFilter(entry('feature.set'), 'features')).toBe(true);
    expect(matchesFilter(entry('feature.set'), 'people')).toBe(false);
    expect(matchesFilter(entry('feature.set'), 'all')).toBe(true);
  });
});
