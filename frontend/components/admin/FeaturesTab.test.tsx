import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi } from './fake-api';
import FeaturesTab from './FeaturesTab';

vi.mock('../../lib/api', async (orig) => ({ ...(await orig<typeof import('../../lib/api')>()), api: (await import('./fake-api')).fakeApi.api }));

const client: any = { id: 'c1', name: 'Bakery', seatLimit: 3, seatsUsed: 1 };
const defaults = { planner: true, 'content-lab': true, creators: true, compose: true, ai: false, 'brand-new': true };
const payload = (over: Record<string, boolean> = {}) => ({
  features: { ...defaults, planner: false, ...over },
  defaults,
  groups: { sections: ['planner', 'content-lab', 'creators'], actions: ['compose', 'ai'] },
});
const sw = (name: RegExp) => screen.getByRole('switch', { name });

describe('Features tab', () => {
  beforeEach(() => {
    fakeApi.reset();
    fakeApi.on('GET', '/admin/clients/c1/features', () => payload());
  });

  it('lists whatever the server sends, with a friendly name, what it hides, its default and a cue when it differs', async () => {
    render(<FeaturesTab client={client} reload={async () => {}} />);
    await screen.findByText('Sections');
    expect(screen.getByText('Actions')).not.toBeNull();
    expect(screen.getByText('Find and shortlist Instagram creators.')).not.toBeNull(); // the new switch has copy
    expect(screen.getByText('Brand new')).not.toBeNull(); // a switch we know nothing about still gets a readable name (in "Other")
    expect(screen.getAllByText('Differs from default')).toHaveLength(1); // planner is off, the default is on
    expect(sw(/^Planner/).getAttribute('aria-checked')).toBe('false');
    expect(sw(/^AI tools/).getAttribute('aria-checked')).toBe('false'); // off is its default, so no cue
    expect(screen.getByText('Default: on. Now: off.')).not.toBeNull();
  });

  it('sends only the switches that changed', async () => {
    fakeApi.on('PUT', '/admin/clients/c1/features', () => payload({ 'content-lab': false }));
    render(<FeaturesTab client={client} reload={async () => {}} />);
    await screen.findByText('Sections');
    const save = () => screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement;
    expect(save().disabled).toBe(true); // nothing changed yet
    fireEvent.click(sw(/^Content Lab/));
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(fakeApi.called('PUT', '/admin/clients/c1/features')).toHaveLength(1));
    expect(fakeApi.called('PUT', '/admin/clients/c1/features')[0].body).toEqual({ 'content-lab': false });
    await waitFor(() => expect(save().disabled).toBe(true)); // saved, so no pending change
  });

  it('puts every switch back to its default on Reset, and saves only the ones that were different', async () => {
    fakeApi.on('PUT', '/admin/clients/c1/features', () => payload({ planner: true }));
    render(<FeaturesTab client={client} reload={async () => {}} />);
    await screen.findByText('Sections');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(sw(/^Planner/).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Differs from default')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(fakeApi.called('PUT', '/admin/clients/c1/features')).toHaveLength(1));
    expect(fakeApi.called('PUT', '/admin/clients/c1/features')[0].body).toEqual({ planner: true });
  });

  it('renders a slot at the top for the approval toggle', async () => {
    render(<FeaturesTab client={client} reload={async () => {}}><label>Require approval slot</label></FeaturesTab>);
    await screen.findByText('Sections');
    expect(screen.getByText('Require approval slot')).not.toBeNull();
  });
});
