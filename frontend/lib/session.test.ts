import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, authHeaders, getActing, setActing, setToken, signOut } from './api';
import { Me, featureOn } from './session';

const me = (over: Partial<Me> = {}): Me => ({
  id: 'u1', email: 'a@b.co', role: 'CLIENT_POC', client: { id: 'c1', name: 'Acme', status: 'ACTIVE' },
  features: { planner: true, ai: false, analytics: false }, acting: false, readOnlyPreview: false, canActAs: false, ...over,
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('acting as a client', () => {
  it('adds no client header until staff pick one', () => {
    setToken('t');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer t' });
  });

  it('names the client on every call, and asks for read only in view mode', () => {
    setToken('t');
    setActing({ id: 'c9', name: 'Beta', mode: 'view' });
    expect(authHeaders()).toEqual({ Authorization: 'Bearer t', 'X-Client-Id': 'c9', 'X-Preview-Mode': 'view' });
    setActing({ id: 'c9', name: 'Beta', mode: 'admin' });
    expect(authHeaders()).toEqual({ Authorization: 'Bearer t', 'X-Client-Id': 'c9' });
  });

  it('keeps staff routes free of the preview headers, so a read-only preview cannot block staff actions', async () => {
    setToken('t');
    setActing({ id: 'c9', name: 'Beta', mode: 'view' });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/admin/preview/exit', { method: 'POST', body: '{}' });
    await api('/posts');
    const sent = (i: number) => (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(sent(0)).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(sent(1)).toMatchObject({ 'X-Client-Id': 'c9', 'X-Preview-Mode': 'view' });
    expect(authHeaders({ acting: false })).toEqual({ Authorization: 'Bearer t' });
    vi.unstubAllGlobals();
  });

  it('ignores a damaged value in storage instead of acting as a stranger', () => {
    window.sessionStorage.setItem('motion-acting', '{"id":5,"mode":"root"}');
    expect(getActing()).toBeNull();
    window.sessionStorage.setItem('motion-acting', 'not json');
    expect(getActing()).toBeNull();
  });

  it('tells listeners when the client changes, and signing out clears it', () => {
    const seen = vi.fn();
    window.addEventListener('motion:acting', seen);
    setActing({ id: 'c9', name: 'Beta', mode: 'view' });
    expect(seen).toHaveBeenCalledTimes(1);
    vi.spyOn(window, 'location', 'get').mockReturnValue({ pathname: '/login', assign: vi.fn() } as unknown as Location);
    signOut();
    expect(getActing()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    window.removeEventListener('motion:acting', seen);
  });
});

describe('api errors', () => {
  it('carries the server reason so a page can handle one blocked widget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 403, code: 'FEATURE_DISABLED', feature: 'analytics', message: 'Not switched on.' }), { status: 403 })));
    const error = await api('/analytics/x').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'FEATURE_DISABLED', feature: 'analytics', message: 'Not switched on.' });
    vi.unstubAllGlobals();
  });
});

describe('which features the app offers', () => {
  it('follows a client\'s switches and treats unknown ones as on', () => {
    expect(featureOn(me(), 'planner')).toBe(true);
    expect(featureOn(me(), 'analytics')).toBe(false);
    expect(featureOn(me(), 'ai')).toBe(false);
    expect(featureOn(me(), 'inbox')).toBe(true);
    expect(featureOn(me({ features: null }), 'analytics')).toBe(true);
    expect(featureOn(null, 'planner')).toBe(false);
  });

  it('shows staff everything, except in a read-only preview where they see what the client sees', () => {
    const staff = me({ role: 'ADMIN', acting: true, features: { analytics: false } });
    expect(featureOn(staff, 'analytics')).toBe(true);
    expect(featureOn({ ...staff, readOnlyPreview: true }, 'analytics')).toBe(false);
    expect(featureOn({ ...staff, readOnlyPreview: true }, 'planner')).toBe(true);
  });
});
