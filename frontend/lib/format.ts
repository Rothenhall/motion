// Shared labels so every page names channels, formats and statuses the same way.

export type Platform = 'instagram' | 'facebook' | 'threads';

export function platformFor(providerOrPlatform?: string | null): Platform {
  if (providerOrPlatform === 'facebook_page' || providerOrPlatform === 'facebook') return 'facebook';
  if (providerOrPlatform === 'threads') return 'threads';
  return 'instagram';
}

export function platformName(platform: string) {
  return platform === 'facebook' || platform === 'facebook_page' ? 'Facebook' : platform === 'threads' ? 'Threads' : 'Instagram';
}

/** Formats each publisher can actually post (see backend publishers.service). */
export const FORMATS_BY_PLATFORM: Record<Platform, string[]> = {
  instagram: ['IMAGE', 'VIDEO', 'REELS', 'STORIES'],
  facebook: ['TEXT', 'IMAGE', 'VIDEO'],
  threads: ['TEXT', 'IMAGE', 'VIDEO'],
};

const FORMAT_LABEL: Record<string, string> = { TEXT: 'Text only', IMAGE: 'Photo', VIDEO: 'Video', REELS: 'Reel', STORIES: 'Story', CAROUSEL: 'Carousel' };
export function formatName(mediaType: string) {
  return FORMAT_LABEL[mediaType] || mediaType.charAt(0) + mediaType.slice(1).toLowerCase();
}

const STATUS_LABEL: Record<string, string> = { SCHEDULED: 'Scheduled', PUBLISHED: 'Published', FAILED: 'Failed', PUBLISHING: 'Publishing', DRAFT: 'Draft' };
export function statusName(status: string) {
  return STATUS_LABEL[status] || status.charAt(0) + status.slice(1).toLowerCase();
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
