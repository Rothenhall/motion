import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TokenPage from './TokenPage';
import { ApiError } from '../lib/api';

const h = vi.hoisted(() => ({ api: vi.fn(), finish: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: h.api }));
vi.mock('../lib/auth-flow', async (orig) => ({ ...(await orig<typeof import('../lib/auth-flow')>()), finishSignIn: h.finish }));

const at = (query: string) => window.history.replaceState(null, '', `/x${query}`);
const invalid = (code: string) => new ApiError('This link is not valid any more.', 404, code);
const session = { token: 'new-token', user: { id: 'u1', email: 'a@b.co', role: 'CLIENT_POC' } };

const fill = (password: string, again = password) => {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Repeat the password'), { target: { value: again } });
  fireEvent.click(screen.getByRole('button', { name: /Set password|Save password/ }));
};

describe('accept invite page', () => {
  beforeEach(() => { h.api.mockReset(); h.finish.mockReset(); });

  it('checks the link first and says who it is for', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'new@acme.test', clientName: 'Acme Bakery', role: 'CLIENT_POC' });
    render(<TokenPage kind="invite" />);
    expect(await screen.findByText('Welcome to Motion')).not.toBeNull();
    expect(h.api).toHaveBeenCalledWith('/auth/accept-invite/validate', { method: 'POST', body: JSON.stringify({ token: 'abc' }) });
    expect(screen.getByText('Acme Bakery')).not.toBeNull();
    expect(screen.getByText(/the main contact for the workspace/)).not.toBeNull();
    expect(screen.getByText('new@acme.test')).not.toBeNull();
  });

  it('says a team member in plain words', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'm@acme.test', clientName: 'Acme Bakery', role: 'CLIENT_MEMBER' });
    render(<TokenPage kind="invite" />);
    expect(await screen.findByText(/as a team member/)).not.toBeNull();
  });

  it('shows one friendly message for a bad, used or expired link', async () => {
    at('?token=old');
    h.api.mockRejectedValueOnce(invalid('INVITE_INVALID'));
    render(<TokenPage kind="invite" />);
    expect(await screen.findByText('This link is no longer valid. Ask your account manager for a new one.')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Go to sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('treats a missing token as an invalid link without asking the server', async () => {
    at('');
    render(<TokenPage kind="invite" />);
    expect(await screen.findByText(/no longer valid/)).not.toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });

  it('offers to try again when the server cannot be reached', async () => {
    at('?token=abc');
    h.api.mockRejectedValueOnce(new ApiError('Request failed (500)', 500));
    render(<TokenPage kind="invite" />);
    expect(await screen.findByText('Could not check this link')).not.toBeNull();
    h.api.mockResolvedValueOnce({ email: 'a@b.co', clientName: 'Acme', role: 'CLIENT_POC' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Welcome to Motion')).not.toBeNull();
  });

  it('asks again when the passwords differ or are too short, and sends nothing', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'a@b.co', clientName: 'Acme', role: 'CLIENT_POC' });
    render(<TokenPage kind="invite" />);
    await screen.findByText('Welcome to Motion');
    fill('longenough1', 'different123');
    expect((await screen.findByRole('alert')).textContent).toContain('do not match');
    fill('short');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('at least 8 characters'));
    expect(h.api).toHaveBeenCalledTimes(1);
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('saves the password, signs in and goes home', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'a@b.co', clientName: 'Acme', role: 'CLIENT_POC' });
    render(<TokenPage kind="invite" />);
    await screen.findByText('Welcome to Motion');
    h.api.mockResolvedValueOnce(session);
    fill('longenough1');
    await waitFor(() => expect(h.finish).toHaveBeenCalledWith(session));
    expect(h.api).toHaveBeenLastCalledWith('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token: 'abc', password: 'longenough1' }) });
  });

  it('switches to the invalid message if the link was used while the page was open', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'a@b.co', clientName: 'Acme', role: 'CLIENT_POC' });
    render(<TokenPage kind="invite" />);
    await screen.findByText('Welcome to Motion');
    h.api.mockRejectedValueOnce(invalid('INVITE_INVALID'));
    fill('longenough1');
    expect(await screen.findByText(/no longer valid/)).not.toBeNull();
  });

  it('can show and hide the password', async () => {
    at('?token=abc');
    h.api.mockResolvedValueOnce({ email: 'a@b.co', clientName: 'Acme', role: 'CLIENT_POC' });
    render(<TokenPage kind="invite" />);
    await screen.findByText('Welcome to Motion');
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('text');
  });
});

describe('reset password page', () => {
  beforeEach(() => { h.api.mockReset(); h.finish.mockReset(); });

  it('uses the reset endpoints and names the account', async () => {
    at('?token=r1');
    h.api.mockResolvedValueOnce({ email: 'me@acme.test' });
    render(<TokenPage kind="reset" />);
    expect(await screen.findByText('Choose a new password')).not.toBeNull();
    expect(h.api).toHaveBeenCalledWith('/auth/reset-password/validate', expect.anything());
    expect(screen.getByText('me@acme.test')).not.toBeNull();
    h.api.mockResolvedValueOnce(session);
    fill('longenough1');
    await waitFor(() => expect(h.finish).toHaveBeenCalledWith(session));
    expect(h.api).toHaveBeenLastCalledWith('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: 'r1', password: 'longenough1' }) });
  });

  it('shows the same friendly message for a dead link', async () => {
    at('?token=r1');
    h.api.mockRejectedValueOnce(invalid('RESET_INVALID'));
    render(<TokenPage kind="reset" />);
    expect(await screen.findByText(/no longer valid/)).not.toBeNull();
  });
});
