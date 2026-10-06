import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Composer from './Composer';

// A fake API that records every call, and can hold one request "in flight" until the test lets it finish.
const fake = vi.hoisted(() => {
  const calls: { path: string; method: string; body?: any }[] = [];
  const gates = new Map<string, Promise<void>>();
  let seq = 0;
  const api = async (path: string, opts: { method?: string; body?: string } = {}) => {
    const method = opts.method || 'GET';
    calls.push({ path, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const gate = gates.get(`${method} ${path}`);
    if (gate) await gate;
    if (method === 'GET') return [];
    if (method === 'POST' && path === '/drafts') return { id: `draft-${++seq}` };
    return { ok: true };
  };
  /** Holds the next matching request until the returned function is called. */
  const hold = (key: string) => {
    let release!: () => void;
    gates.set(key, new Promise<void>((resolve) => { release = () => { gates.delete(key); resolve(); }; }));
    return release;
  };
  const reset = () => { calls.length = 0; gates.clear(); seq = 0; };
  const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length;
  return { calls, api, hold, reset, count };
});
vi.mock('../lib/api', () => ({ API: 'http://localhost:3001', authHeaders: () => ({}), api: fake.api }));

const accounts = [{ id: 'acc-1', provider: 'instagram', externalId: 'ig-1', name: 'Studio' }];
const AUTOSAVE_MS = 1300; // the composer waits 1.2s after typing stops

const setup = () => {
  const onOpenChange = vi.fn();
  render(<Composer open onOpenChange={onOpenChange} accounts={accounts} accountsLoading={false} />);
  return { onOpenChange };
};
const caption = () => screen.getByLabelText(/^Caption/) as HTMLTextAreaElement;
const type = (value: string) => fireEvent.change(caption(), { target: { value } });
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('Composer attachments', () => {
  beforeEach(() => fake.reset());

  it('shows an attached photo from the API, and says so when it cannot be loaded', () => {
    setup();
    fireEvent.click(screen.getByText('Paste media links instead'));
    fireEvent.change(screen.getByLabelText('Media links, one per line'), { target: { value: 'https://tunnel.example.dev/media/1-aaaaaaaa.png' } });

    const img = screen.getByAltText('Attachment 1') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('http://localhost:3001/media/1-aaaaaaaa.png');

    fireEvent.error(img);
    expect(screen.queryByAltText('Attachment 1')).toBeNull();
    expect(screen.getByText('Preview unavailable')).not.toBeNull();
  });
});

describe('Composer drafts', () => {
  beforeEach(() => { vi.useFakeTimers(); fake.reset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('saves a draft once typing stops, then keeps updating that same draft', async () => {
    setup();
    await wait(0);
    type('First thoughts');
    await wait(AUTOSAVE_MS);
    expect(fake.count('POST', '/drafts')).toBe(1);

    type('First thoughts, longer');
    await wait(AUTOSAVE_MS);
    expect(fake.count('POST', '/drafts')).toBe(1);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/drafts/draft-1' });
  });

  it('never saves an empty editor', async () => {
    setup();
    await wait(AUTOSAVE_MS * 2);
    expect(fake.count('POST', '/drafts')).toBe(0);
  });

  it('"Save and close" updates the existing draft instead of creating a second one', async () => {
    const { onOpenChange } = setup();
    await wait(0);
    type('A caption worth keeping');
    await wait(AUTOSAVE_MS);
    expect(fake.count('POST', '/drafts')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save and close' }));
    await wait(50);

    expect(fake.count('POST', '/drafts')).toBe(1); // still one draft
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/drafts/draft-1' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a save still running when the editor is closed finishes on its own draft and does not leak into the next one', async () => {
    setup();
    await wait(0);
    const finish = fake.hold('POST /drafts');
    type('Written just before closing');
    await wait(AUTOSAVE_MS); // the first save is now in flight

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); // closes and queues one more save, then clears the editor
    await wait(0);
    finish();
    await wait(50);

    expect(fake.count('POST', '/drafts')).toBe(1); // the queued save updated the new draft, it did not create another
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PATCH', path: '/drafts/draft-1' });
    expect(caption().value).toBe(''); // the editor is blank again
    expect(screen.queryByRole('button', { name: /Discard/ })).toBeNull(); // and is not tied to the old draft
  });

  it('scheduling cancels the pending autosave, so no stray draft is left behind', async () => {
    setup();
    await wait(0);
    fireEvent.click(screen.getByText('Paste media links instead'));
    fireEvent.change(screen.getByLabelText('Media links, one per line'), { target: { value: 'https://x.test/media/1-aaaaaaaa.jpg' } });
    type('Ready to go');

    const finish = fake.hold('POST /posts'); // the post is slow to schedule, longer than the autosave delay
    fireEvent.click(screen.getByRole('button', { name: /Schedule post/ }));
    await wait(AUTOSAVE_MS);
    finish();
    await wait(50);

    expect(fake.count('POST', '/posts')).toBe(1);
    expect(fake.count('POST', '/drafts')).toBe(0);
  });
});
