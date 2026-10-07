import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActing, getToken, setActing } from './api';
import { finishSignIn, passwordProblem } from './auth-flow';

afterEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); });

describe('finishSignIn', () => {
  it('sends staff to the admin area and clients to Overview', () => {
    const go = vi.fn();
    finishSignIn({ token: 't1', user: { id: 'u', email: 'a@b.co', role: 'ADMIN' } }, go);
    expect(go).toHaveBeenLastCalledWith('/admin');
    finishSignIn({ token: 't2', user: { id: 'u', email: 'a@b.co', role: 'CLIENT_POC' } }, go);
    expect(go).toHaveBeenLastCalledWith('/');
    finishSignIn({ token: 't3', user: { id: 'u', email: 'a@b.co', role: 'CLIENT_MEMBER' } }, go);
    expect(go).toHaveBeenLastCalledWith('/');
  });

  it('keeps the new token and drops any old preview', () => {
    setActing({ id: 'c9', name: 'Beta', mode: 'admin' });
    finishSignIn({ token: 'fresh', user: { id: 'u', email: 'a@b.co', role: 'ADMIN' } }, vi.fn());
    expect(getToken()).toBe('fresh');
    expect(getActing()).toBeNull();
  });
});

describe('passwordProblem', () => {
  it('explains what is wrong in plain words', () => {
    expect(passwordProblem('short', 'short')).toBe('Use at least 8 characters.');
    expect(passwordProblem('longenough1', 'other-thing1')).toBe('The two passwords do not match.');
    expect(passwordProblem('longenough1', 'longenough1')).toBeNull();
  });
});
