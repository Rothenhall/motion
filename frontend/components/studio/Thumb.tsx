'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { isVideoUrl, mediaSrc, parseMedia, toneFor } from '@/lib/media';
import { formatName } from '@/lib/format';

type Props = {
  id: string;
  media?: string | string[] | null;
  mediaType?: string;
  caption?: string | null;
  className?: string;
  /** Aspect ratio as a CSS value, e.g. "4 / 5". Defaults to square. */
  ratio?: string;
  badge?: string;
};

/** The post's own media as a thumbnail, or a quiet tone card with the caption when there is none. */
export default function Thumb({ id, media, mediaType, caption, className, ratio = '1 / 1', badge }: Props) {
  const urls = parseMedia(media);
  const first = urls[0] ? mediaSrc(urls[0]) : undefined;
  // Remember which file failed, not just that something did, so swapping the media gets a fresh try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const video = !!first && (isVideoUrl(first) || mediaType === 'VIDEO' || mediaType === 'REELS');
  const showMedia = !!first && failedSrc !== first;
  return (
    <div className={cn('st-thumb', !showMedia && toneFor(id), className)} style={{ aspectRatio: ratio }}>
      {showMedia && (video
        // eslint-disable-next-line jsx-a11y/media-has-caption
        ? <video src={`${first}#t=0.4`} muted playsInline preload="metadata" onError={() => setFailedSrc(first)} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={first} alt="" loading="lazy" onError={() => setFailedSrc(first)} />)}
      {!showMedia && <span className="st-thumb-text">{caption ? caption.slice(0, 70) : formatName(mediaType || 'TEXT')}</span>}
      {video && showMedia && <span className="st-play" aria-hidden="true" />}
      {badge && <span className="st-badge">{badge}</span>}
      {urls.length > 1 && <span className="st-badge st-badge-count">{urls.length}</span>}
    </div>
  );
}
