import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorPage from './error';
import NotFound from './not-found';

describe('error screen', () => {
  it('tells the person what happened and lets them try again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();
    render(<ErrorPage error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe('not-found screen', () => {
  it('offers a way back to the Overview', () => {
    render(<NotFound />);
    expect(screen.getByText('We could not find that page')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Overview' }).getAttribute('href')).toBe('/');
  });
});
