'use client';

import { Icon } from '../Icons';
import Thumb from './Thumb';
import { formatName, platformName, type Platform } from '@/lib/format';

/** How a post will look on one platform: header, media, caption. Captions are clipped where the platform clips them. */
export default function PhonePreview({ platform, name, caption, media, mediaType, id = 'preview', ratio }: { platform: Platform; name: string; caption?: string | null; media?: string | string[] | null; mediaType?: string; id?: string; ratio?: string }) {
  const clip = platform === 'instagram' ? 125 : platform === 'threads' ? 500 : 480;
  const text = caption || '';
  const clipped = text.length > clip;
  const reel = mediaType === 'REELS' || mediaType === 'STORIES';
  const mediaRatio = ratio || (reel ? '9 / 14' : platform === 'instagram' ? '4 / 5' : '1 / 1');
  const hasMedia = !!media && (Array.isArray(media) ? media.length > 0 : media !== '[]');
  return (
    <figure className="st-phone" aria-label={`${platformName(platform)} preview`}>
      <div className="st-phone-bar"><span className="st-phone-av" /><span className="st-phone-name">{name}</span><Icon name={platform} size={13} /></div>
      {platform === 'threads' && <p className="st-phone-text">{clipped ? `${text.slice(0, clip)}…` : text || 'Your text appears here.'}</p>}
      {(platform !== 'threads' || hasMedia) && mediaType !== 'TEXT' && (
        <Thumb id={id} media={media} mediaType={mediaType} caption={text} ratio={mediaRatio} className="st-phone-media" />
      )}
      {platform !== 'threads' && (
        <p className="st-phone-text"><b>{name}</b> {clipped ? <>{text.slice(0, clip)}<span className="muted">… more</span></> : text || <span className="muted">{formatName(mediaType || 'IMAGE')} caption appears here.</span>}</p>
      )}
    </figure>
  );
}
