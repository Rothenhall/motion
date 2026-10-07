import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewClientDialog from './NewClientDialog';

// A plain function (not vi.fn) so a rejected promise it returns is not tracked by the mock and reported as unhandled.
const fake = vi.hoisted(() => {
  const state = { impl: (async () => undefined) as (...args: any[]) => Promise<any>, calls: [] as any[][] };
  return { state, api: (...args: any[]) => { state.calls.push(args); return state.impl(...args); } };
});
vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: fake.api }));

const fill = (name: string, email: string) => {
  fireEvent.change(screen.getByLabelText('Client name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Main contact email'), { target: { value: email } });
};

describe('New client dialog', () => {
  beforeEach(() => { fake.state.calls.length = 0; });

  it('creates the client and then shows the invite link with its expiry and the no-email sentence', async () => {
    const created = vi.fn();
    fake.state.impl = async () => ({
      client: { id: 'c1', name: 'Bakery' },
      invite: { email: 'baker@example.com', url: 'http://app.test/accept-invite?token=abc', expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString() },
    });
    render(<NewClientDialog open onOpenChange={() => {}} onCreated={created} />);
    fill('Bakery', 'baker@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));

    await screen.findByText('Bakery is ready');
    expect(fake.state.calls[0]).toEqual(['/admin/clients', { method: 'POST', body: JSON.stringify({ name: 'Bakery', pocEmail: 'baker@example.com' }) }]);
    expect((screen.getByLabelText('Invite link') as HTMLInputElement).value).toBe('http://app.test/accept-invite?token=abc');
    expect(screen.getByText('No email is sent. Copy this link and send it to baker@example.com.')).not.toBeNull();
    expect(screen.getByText(/^Expires/).textContent).toMatch(/in 3 days|in 72 hours/);
    expect(screen.getByRole('button', { name: /Copy/ })).not.toBeNull();
    expect(created).toHaveBeenCalledWith({ id: 'c1', name: 'Bakery' });
  });

  it('shows the server\'s message when the email is already used (409), and stays open to fix it', async () => {
    const { ApiError } = await import('../../lib/api');
    fake.state.impl = (() => Promise.reject(new ApiError('That email already has an account.', 409)));
    render(<NewClientDialog open onOpenChange={() => {}} />);
    fill('Bakery', 'taken@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('That email already has an account.'));
    expect(screen.getByLabelText('Client name')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Create client' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a validation message (400) from the server', async () => {
    const { ApiError } = await import('../../lib/api');
    fake.state.impl = (() => Promise.reject(new ApiError('Enter a valid email address.', 400)));
    render(<NewClientDialog open onOpenChange={() => {}} />);
    fill('Bakery', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.'));
  });

  it('disables the button while the request is running', async () => {
    let finish!: (v: unknown) => void;
    fake.state.impl = () => new Promise((resolve) => { finish = resolve; });
    render(<NewClientDialog open onOpenChange={() => {}} />);
    fill('Bakery', 'baker@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Create client' }));
    const busy = await screen.findByRole('button', { name: 'Creating…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish({ client: { id: 'c1', name: 'Bakery' }, invite: { email: 'baker@example.com', url: 'u', expiresAt: new Date().toISOString() } });
    await screen.findByText('Bakery is ready');
  });
});
