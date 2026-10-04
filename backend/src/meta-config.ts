/** Graph API version for graph.facebook.com and graph.instagram.com calls. Threads has its own (v1.0). */
export function graphVersion() {
  return process.env.META_GRAPH_VERSION || 'v25.0';
}

export const THREADS_GRAPH = 'https://graph.threads.net/v1.0';

/** Instagram publishing only accepts JPEG images. */
export const NON_JPEG_IMAGE = /\.(png|webp|gif|heic|heif|bmp|tiff?)(\?|#|$)/i;
export const VIDEO_URL = /\.(mp4|mov)(\?|#|$)/i;

/** A private reply must be sent within 7 days of the comment. */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 86_400_000;
