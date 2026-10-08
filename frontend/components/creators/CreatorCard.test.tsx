import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreatorCard from './CreatorCard';

const creator = {
  username: 'baker.maya',
  biography: 'Sourdough and slow mornings.',
  country: 'IN',
  followers: 42000,
  is_account_verified: true,
  onboarded_status: 'ONBOARDED',
  has_brand_partnership_experience: true,
  portfolio_url: 'https://example.dev/portfolio',
};

describe('CreatorCard', () => {
  it('shows the handle, bio, and compact follower count', () => {
    render(<CreatorCard creator={creator} saved={false} saving={false} onSave={() => {}} />);
    expect(screen.getByText('@baker.maya')).not.toBeNull();
    expect(screen.getByText('Sourdough and slow mornings.')).not.toBeNull();
    expect(screen.getByText('IN · 42K followers')).not.toBeNull();
    expect(screen.getByText('Verified')).not.toBeNull();
    expect(screen.getByText('On marketplace')).not.toBeNull();
  });

  it('saves once, then shows the saved state', () => {
    const onSave = vi.fn();
    const { rerender } = render(<CreatorCard creator={creator} saved={false} saving={false} onSave={onSave} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    rerender(<CreatorCard creator={creator} saved saving={false} onSave={onSave} />);
    expect(screen.getByText('Saved')).not.toBeNull();
  });
});
