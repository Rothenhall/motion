import { BadRequestException } from '@nestjs/common';
import { NON_JPEG_IMAGE, VIDEO_URL } from './meta-config';

/** Instagram carousels hold ten items, so no post or draft needs more. */
const MAX_MEDIA = 10;
const MAX_URL = 2048;

/** The media list of a post or draft: a list of short links, at most ten. Posts and drafts share these limits. */
export function mediaUrlList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((u) => typeof u !== 'string' || u.length > MAX_URL)) throw new BadRequestException('Media URLs must be a list of short links.');
  if (value.length > MAX_MEDIA) throw new BadRequestException(`A post can have at most ${MAX_MEDIA} media files.`);
  return value;
}

/** Instagram only publishes JPEG images (video is fine). Refuse at scheduling time rather than fail at publish time. */
export function assertInstagramJpeg(mediaType: string, urls: string[]) {
  if (mediaType === 'VIDEO' || mediaType === 'REELS') return;
  if (urls.some((u) => NON_JPEG_IMAGE.test(u) && !VIDEO_URL.test(u))) throw new BadRequestException('Instagram only publishes JPEG images. Upload a JPG instead of PNG, WebP or GIF.');
}
