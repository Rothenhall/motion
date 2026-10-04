import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from './prisma.service';
import { decryptToken } from './auth/crypto';
import { graphVersion, NON_JPEG_IMAGE, THREADS_GRAPH, VIDEO_URL } from './meta-config';

/**
 * Seconds between container status checks: about 5 minutes in all, the longest
 * Meta says to wait. Most images finish on the first check.
 */
const CONTAINER_WAITS = [3, 5, 10, 20, 30, 60, 60, 60, 60];

@Injectable()
export class PublishersService {
  constructor(private prisma: PrismaService) {}
  private v() { return graphVersion(); }
  /** Overridden in tests so container polling doesn't really wait. */
  sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  /**
   * Publishes a post the caller has already claimed (status PUBLISHING, see
   * SchedulerService). Claiming first is what stops two scheduler ticks from
   * publishing the same post twice.
   */
  async publish(postId: string) {
    const post = await this.prisma.scheduledPost.findUnique({ where: { id: postId }, include: { account: true } });
    if (!post || post.status !== 'PUBLISHING') return;
    try {
      const urls: string[] = JSON.parse(post.mediaUrls || '[]');
      const account = { ...post.account, accessToken: decryptToken(post.account.accessToken) };
      let externalId = '';
      if (post.platform === 'instagram') externalId = await this.publishInstagram(account, post.caption, urls, post.mediaType);
      else if (post.platform === 'facebook') externalId = await this.publishFacebook(account, post.caption, urls, post.mediaType);
      else if (post.platform === 'threads') externalId = await this.publishThreads(account, post.caption, urls, post.mediaType);
      else throw new Error(`unknown platform ${post.platform}`);
      await this.prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'PUBLISHED', externalId } });
    } catch (e: any) {
      await this.prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'FAILED', error: e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message || e) } });
    }
  }

  // Instagram (Business Login): containers live on graph.instagram.com and only
  // accept the IG user token — graph.facebook.com cannot parse it (OAuth 190).
  private async publishInstagram(acc: any, caption?: string | null, urls: string[] = [], mediaType = 'IMAGE') {
    const base = `https://graph.instagram.com/${this.v()}/${acc.externalId}`;
    const first = urls[0];
    if (!first) throw new Error('Instagram needs a photo or video — attach a file or paste a public media URL.');
    const isVideo = mediaType === 'VIDEO' || mediaType === 'REELS' || VIDEO_URL.test(first);
    if (!isVideo && NON_JPEG_IMAGE.test(first)) throw new Error('Instagram only publishes JPEG images. Convert the image to JPG and try again.');
    await this.checkInstagramQuota(base, acc.accessToken);

    const params: any = { access_token: acc.accessToken, caption: caption || undefined };
    if (mediaType === 'REELS') { params.media_type = 'REELS'; params.video_url = first; }
    else if (mediaType === 'STORIES') { params.media_type = 'STORIES'; if (isVideo) params.video_url = first; else params.image_url = first; }
    else if (mediaType === 'CAROUSEL') throw new Error('Carousel posts are not supported yet. Post a single image or video.');
    else if (isVideo) { params.media_type = 'VIDEO'; params.video_url = first; }
    else params.image_url = first;
    const c = await axios.post(`${base}/media`, params);
    const creationId = c.data.id;
    await this.waitForContainer('Instagram', async () => {
      const s = await axios.get(`https://graph.instagram.com/${this.v()}/${creationId}`, { params: { fields: 'status_code,status', access_token: acc.accessToken } });
      return { status: s.data.status_code, detail: s.data.status };
    });
    const p = await axios.post(`${base}/media_publish`, { creation_id: creationId, access_token: acc.accessToken });
    return p.data.id;
  }

  /** IG allows 100 API-published posts per account per 24 hours. A failed check doesn't block publishing. */
  private async checkInstagramQuota(base: string, token: string) {
    let usage: number | undefined;
    let total: number | undefined;
    try {
      const r = await axios.get(`${base}/content_publishing_limit`, { params: { fields: 'quota_usage,config', access_token: token } });
      const row = r.data?.data?.[0];
      usage = row?.quota_usage;
      total = row?.config?.quota_total;
    } catch {
      return;
    }
    if (typeof usage === 'number' && typeof total === 'number' && usage >= total) {
      throw new Error(`Instagram's limit of ${total} posts in 24 hours is reached for this account. Reschedule this post for later.`);
    }
  }

  /**
   * Polls a media container until it is FINISHED. ERROR or EXPIRED, or still
   * processing after about 5 minutes, fails the post instead of publishing anyway.
   */
  private async waitForContainer(label: string, check: () => Promise<{ status?: string; detail?: string }>) {
    for (const wait of CONTAINER_WAITS) {
      const { status, detail } = await check();
      if (status === 'FINISHED' || status === 'PUBLISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`${label} could not process the media (${status}${detail ? `: ${detail}` : ''}).`);
      }
      await this.sleep(wait * 1000);
    }
    const { status, detail } = await check();
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    throw new Error(`${label} was still processing the media after 5 minutes (${status || 'unknown'}${detail ? `: ${detail}` : ''}).`);
  }

  // Facebook Page: photos / videos / feed. Immediate publish (use scheduled_publish_time for native FB scheduling).
  private async publishFacebook(acc: any, caption?: string | null, urls: string[] = [], mediaType = 'IMAGE') {
    const v = this.v();
    const first = urls[0];
    if (!first) {
      const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/feed`, { message: caption, access_token: acc.accessToken });
      return r.data.id;
    }
    if (mediaType === 'VIDEO' || mediaType === 'REELS' || VIDEO_URL.test(first)) {
      const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/videos`, { file_url: first, description: caption, access_token: acc.accessToken });
      return r.data.id;
    }
    const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/photos`, { url: first, caption, access_token: acc.accessToken });
    // post_id is the feed post (what insights and imports key on); id is the photo.
    return r.data.post_id || r.data.id;
  }

  // Threads: POST /{user-id}/threads, wait for the container to finish, then /threads_publish.
  private async publishThreads(acc: any, caption?: string | null, urls: string[] = [], mediaType = 'TEXT') {
    const first = urls[0];
    let media_type = 'TEXT';
    const body: any = { access_token: acc.accessToken, text: caption || '' };
    if (first) {
      media_type = mediaType === 'VIDEO' || mediaType === 'REELS' || VIDEO_URL.test(first) ? 'VIDEO' : 'IMAGE';
      if (media_type === 'VIDEO') body.video_url = first; else body.image_url = first;
    }
    body.media_type = media_type;
    const c = await axios.post(`${THREADS_GRAPH}/${acc.externalId}/threads`, body);
    const creationId = c.data.id;
    await this.waitForContainer('Threads', async () => {
      const s = await axios.get(`${THREADS_GRAPH}/${creationId}`, { params: { fields: 'status,error_message', access_token: acc.accessToken } });
      return { status: s.data.status, detail: s.data.error_message };
    });
    const p = await axios.post(`${THREADS_GRAPH}/${acc.externalId}/threads_publish`, { creation_id: creationId, access_token: acc.accessToken });
    return p.data.id;
  }

  // Comment replies. Instagram accounts connect through Instagram Login, so
  // every IG call goes to graph.instagram.com; Pages use graph.facebook.com.
  async replyInstagramComment(commentId: string, text: string, token: string) {
    const r = await axios.post(`https://graph.instagram.com/${this.v()}/${commentId}/replies`, { message: text, access_token: token });
    return r.data.id;
  }
  async hideInstagramComment(commentId: string, hide: boolean, token: string) {
    const r = await axios.post(`https://graph.instagram.com/${this.v()}/${commentId}`, null, { params: { hide, access_token: token } });
    return r.data;
  }
  /** Comment-to-DM: one private reply per comment, within 7 days of it. */
  async privateReplyInstagram(igId: string, commentId: string, text: string, token: string) {
    const r = await axios.post(`https://graph.instagram.com/${this.v()}/${igId}/messages`, { recipient: { comment_id: commentId }, message: { text }, access_token: token });
    return r.data;
  }
  async replyFacebookComment(commentId: string, text: string, token: string) {
    const r = await axios.post(`https://graph.facebook.com/${this.v()}/${commentId}/comments`, { message: text, access_token: token });
    return r.data.id;
  }
  /** Facebook comment-to-DM (Messenger private reply), same once-within-7-days rule. Needs pages_messaging. */
  async privateReplyFacebook(pageId: string, commentId: string, text: string, token: string) {
    const r = await axios.post(`https://graph.facebook.com/${this.v()}/${pageId}/messages`, { recipient: { comment_id: commentId }, message: { text }, access_token: token });
    return r.data;
  }
}
