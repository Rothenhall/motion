import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMe, makePreview, makeStaff } from '../test/fixtures';
import PreviewBar from './PreviewBar';
import { SessionProvider } from '../lib/session';

const h = vi.hoisted(() => ({ me: null as unknown, push: vi.fn(), start: vi.fn(), exit: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), api: vi.fn(async () => h.me) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('../lib/preview', () => ({ startPreview: h.start, exitPreview: h.exit }));

const show = (me: unknown) => {
  h.me = me;
  window.localStorage.setItem('motion-session', 'token');
  return render(<SessionProvider><PreviewBar /></SessionProvider>);
};

describe('PreviewBar', () => {
  beforeEach(() => { window.localStorage.clear(); h.push.mockReset(); h.start.mockReset().mockResolvedValue(undefined); h.exit.mockReset().mockResolvedValue(undefined); });

  it('is not shown to clients, or to staff who are not previewing', async () => {
    const { container } = show(makeStaff());
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('.preview-bar')).toBeNull();
  });

  it('says whose workspace it is and that a read-only preview shows what the client sees', async () => {
    show(makePreview('view'));
    expect(await screen.findByText('Previewing Acme Bakery')).not.toBeNull();
    expect(screen.getByText('Read only. You see what the client sees.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'View as client' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Admin controls' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('says changes apply to the client when admin controls are on', async () => {
    show(makePreview('admin'));
    expect(await screen.findByText('Admin controls on. Changes apply to the client.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Admin controls' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('switches mode by starting the preview again in the other mode', async () => {
    show(makePreview('view'));
    fireEvent.click(await screen.findByRole('button', { name: 'Admin controls' }));
    await waitFor(() => expect(h.start).toHaveBeenCalledWith({ id: 'c1', name: 'Acme Bakery' }, 'admin'));
  });

  it('does nothing when the current mode is chosen again', async () => {
    show(makePreview('admin'));
    fireEvent.click(await screen.findByRole('button', { name: 'Admin controls' }));
    expect(h.start).not.toHaveBeenCalled();
  });

  it('leaves the preview and goes to the client page', async () => {
    show(makePreview('view'));
    fireEvent.click(await screen.findByRole('button', { name: 'Exit preview' }));
    await waitFor(() => expect(h.exit).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/admin/clients/c1'));
  });

  it('announces the mode politely', async () => {
    show(makePreview('view'));
    const note = await screen.findByText('Read only. You see what the client sees.');
    expect(note.getAttribute('aria-live')).toBe('polite');
  });

  it('is ignored for a client user even if the server said acting', async () => {
    const { container } = show(makeMe({ acting: false }));
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector('.preview-bar')).toBeNull();
  });
});
