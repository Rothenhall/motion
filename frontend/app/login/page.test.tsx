import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './page';
import { ApiError } from '../../lib/api';

const h = vi.hoisted(() => ({ api: vi.fn(), finish: vi.fn() }));
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: h.api }));
vi.mock('../../lib/auth-flow', async (orig) => ({ ...(await orig<typeof import('../../lib/auth-flow')>()), finishSignIn: h.finish }));

const signIn = () => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
};

describe('login page', () => {
  beforeEach(() => { h.api.mockReset(); h.finish.mockReset(); });

  it('has no way to create an account, and tells people who to ask', () => {
    render(<Login />);
    expect(screen.queryByText(/create an account/i)).toBeNull();
    expect(screen.queryByText(/new to motion/i)).toBeNull();
    expect(screen.queryByText(/first admin/i)).toBeNull();
    expect(screen.getByText('Need access? Ask your account manager.')).not.toBeNull();
  });

  it('signs in and hands the session over, so the role decides where they land', async () => {
    const res = { token: 't', user: { id: 'u', email: 'a@b.co', role: 'ADMIN' } };
    h.api.mockResolvedValueOnce(res);
    render(<Login />);
    signIn();
    await waitFor(() => expect(h.finish).toHaveBeenCalledWith(res));
    expect(h.api).toHaveBeenCalledWith('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'secret-pass-1' }) });
  });

  it('shows the server message for a wrong password or a locked account', async () => {
    h.api.mockRejectedValueOnce(new ApiError('Email or password is incorrect.', 401));
    render(<Login />);
    signIn();
    expect((await screen.findByRole('alert')).textContent).toContain('Email or password is incorrect.');
    expect(h.finish).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
