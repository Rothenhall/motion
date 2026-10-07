import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminGate from './AdminGate';

const replace = vi.fn();
const session = vi.hoisted(() => ({ value: { status: 'loading', me: null, error: null, refresh: async () => {} } as any }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock('../../lib/session', async (orig) => ({ ...(await orig<typeof import('../../lib/session')>()), useSession: () => session.value }));

const me = (role: string) => ({ id: 'u1', email: 'a@b.co', role, client: null, features: null, acting: false, readOnlyPreview: false, canActAs: role === 'ADMIN' });

describe('AdminGate', () => {
  beforeEach(() => { replace.mockClear(); });

  it('shows nothing while the session loads, and does not redirect yet', () => {
    session.value = { status: 'loading', me: null, error: null, refresh: async () => {} };
    const { container } = render(<AdminGate><p>secret</p></AdminGate>);
    expect(container.textContent).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a client user to the home page without showing the page', () => {
    session.value = { status: 'ready', me: me('CLIENT_POC'), error: null, refresh: async () => {} };
    const { container } = render(<AdminGate><p>secret</p></AdminGate>);
    expect(container.textContent).toBe('');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('shows the page to staff', () => {
    session.value = { status: 'ready', me: me('ADMIN'), error: null, refresh: async () => {} };
    render(<AdminGate><p>secret</p></AdminGate>);
    expect(screen.getByText('secret')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says so when Motion cannot be reached, with a way to try again', () => {
    const refresh = vi.fn(async () => {});
    session.value = { status: 'error', me: null, error: 'Could not reach Motion.', refresh };
    render(<AdminGate><p>secret</p></AdminGate>);
    expect(screen.getByRole('alert').textContent).toContain('Could not reach Motion.');
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText('secret')).toBeNull();
  });
});
