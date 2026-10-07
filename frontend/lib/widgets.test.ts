import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, PREVIEW_READ_ONLY_MESSAGE, api } from './api';
import { tolerate } from './widgets';

afterEach(() => vi.unstubAllGlobals());

describe('tolerate', () => {
  it('returns the data when the request works', async () => {
    expect(await tolerate(Promise.resolve([1]), [])).toEqual([1]);
  });

  it('turns FEATURE_DISABLED into the fallback and says which switch', async () => {
    const blocked = vi.fn();
    const out = await tolerate(Promise.reject(new ApiError('off', 403, 'FEATURE_DISABLED', 'analytics')), null, blocked);
    expect(out).toBeNull();
    expect(blocked).toHaveBeenCalledWith('analytics');
  });

  it('still throws every other failure', async () => {
    await expect(tolerate(Promise.reject(new ApiError('boom', 500)), null)).rejects.toThrow('boom');
    await expect(tolerate(Promise.reject(new Error('network')), null)).rejects.toThrow('network');
  });
});

describe('read-only preview message', () => {
  it('replaces the server wording with one friendly sentence everywhere', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 403, code: 'PREVIEW_READ_ONLY', message: 'This preview is read only. Turn on admin controls to make changes.' }), { status: 403 })));
    const error = await api('/posts', { method: 'POST', body: '{}' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('PREVIEW_READ_ONLY');
    expect(error.message).toBe(PREVIEW_READ_ONLY_MESSAGE);
    expect(PREVIEW_READ_ONLY_MESSAGE).toBe('This preview is read only. Switch on admin controls to make changes.');
  });
});
