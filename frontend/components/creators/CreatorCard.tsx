'use client';

import { Icon } from '../Icons';
import { compactNumber } from '../../lib/format';

export type Creator = {
  id?: string;
  username: string;
  profile_picture_url?: string;
  biography?: string;
  country?: string;
  gender?: string;
  followers?: number;
  is_account_verified?: boolean;
  onboarded_status?: string;
  email?: string;
  portfolio_url?: string;
  has_brand_partnership_experience?: boolean;
};

export function initials(username: string) {
  const clean = username.replace(/^@/, '');
  return (clean.slice(0, 2) || 'IG').toUpperCase();
}

export default function CreatorCard({ creator, saved, saving, onSave }: {
  creator: Creator;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const handle = creator.username.replace(/^@/, '');
  return (
    <article className="card creator-card" aria-label={`Creator ${handle}`}>
      <div className="creator-head">
        {creator.profile_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="creator-avatar" src={creator.profile_picture_url} alt="" loading="lazy" />
        ) : (
          <div className="creator-avatar creator-avatar-fallback" aria-hidden="true">{initials(handle)}</div>
        )}
        <div className="creator-copy">
          <strong>@{handle}</strong>
          <span>{[creator.country, typeof creator.followers === 'number' ? `${compactNumber(creator.followers)} followers` : null].filter(Boolean).join(' · ') || 'Instagram creator'}</span>
        </div>
        {creator.is_account_verified && <span className="status-pill status-published" title="Verified account">Verified</span>}
      </div>
      {creator.biography && <p className="creator-bio">{creator.biography}</p>}
      <div className="tag-row">
        {creator.onboarded_status && <span className="tag tag-brand">{creator.onboarded_status === 'ONBOARDED' ? 'On marketplace' : creator.onboarded_status}</span>}
        {creator.has_brand_partnership_experience && <span className="tag">Ads experience</span>}
        {creator.gender && <span className="tag tag-muted">{creator.gender}</span>}
      </div>
      <div className="creator-actions">
        <button className={saved ? 'btn btn-sm btn-soft' : 'btn btn-sm'} type="button" disabled={saved || saving} onClick={onSave}>
          <Icon name={saved ? 'check' : 'star'} size={13} /> {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
        </button>
        {creator.portfolio_url && (
          <a className="btn btn-sm btn-ghost" href={creator.portfolio_url} target="_blank" rel="noreferrer">
            <Icon name="external" size={13} /> Portfolio
          </a>
        )}
      </div>
    </article>
  );
}
