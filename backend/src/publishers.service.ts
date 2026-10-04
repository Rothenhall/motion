import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from './prisma.service';
import { decryptToken } from './auth/crypto';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class PublishersService {
  constructor(private prisma: PrismaService) {}
  private v() { return process.env.META_GRAPH_VERSION || 'v22.0'; }

  async publish(postId: string) {
    const post = await this.prisma.scheduledPost.findUnique({ where: { id: postId }, include: { account: true } });
    if (!post || post.status === 'PUBLISHED') return;
    await this.prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'PUBLISHING', error: null } });
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
    const base = `https://graph.instagram.com/${acc.externalId}`;
    const first = urls[0];
    if (!first) throw new Error('Instagram needs a photo or video — attach a file or paste a public media URL.');
    const params: any = { access_token: acc.accessToken, caption: caption || undefined };
    if (mediaType === 'REELS') { params.media_type = 'REELS'; params.video_url = first; }
    else if (mediaType === 'STORIES') { params.media_type = 'STORIES'; if (first?.match(/mp4|mov/i)) params.video_url = first; else params.image_url = first; }
    else if (mediaType === 'CAROUSEL') throw new Error('CAROUSEL needs children containers — extend publishers.service');
    else if (mediaType === 'VIDEO' || first?.match(/mp4|mov/i)) { params.media_type = 'VIDEO'; params.video_url = first; }
    else params.image_url = first;
    const c = await axios.post(`${base}/media`, params);
    const creationId = c.data.id;
    for (let i = 0; i < 12; i++) {
      try {
        const s = await axios.get(`https://graph.instagram.com/${creationId}?fields=status_code&access_token=${acc.accessToken}`);
        if (s.data.status_code === 'FINISHED') break;
        if (s.data.status_code === 'ERROR') throw new Error('IG container failed');
      } catch { break; }
      await sleep(5000);
    }
    const p = await axios.post(`${base}/media_publish`, { creation_id: creationId, access_token: acc.accessToken });
    return p.data.id;
  }

  // Facebook Page: photos / videos / feed. Immediate publish (use scheduled_publish_time for native FB scheduling).
  private async publishFacebook(acc: any, caption?: string | null, urls: string[] = [], mediaType = 'IMAGE') {
    const v = this.v();
    const first = urls[0];
    if (!first) {
      const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/feed`, { message: caption, access_token: acc.accessToken });
      return r.data.id;
    }
    if (first.match(/mp4|mov/i)) {
      const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/videos`, { file_url: first, description: caption, access_token: acc.accessToken });
      return r.data.id;
    }
    const r = await axios.post(`https://graph.facebook.com/${v}/${acc.externalId}/photos`, { url: first, caption, access_token: acc.accessToken });
    // post_id is the feed post (what insights and imports key on); id is the photo.
    return r.data.post_id || r.data.id;
  }

  // Threads: POST /{user-id}/threads then /threads_publish (wait ~30s)
  private async publishThreads(acc: any, caption?: string | null, urls: string[] = [], mediaType = 'TEXT') {
    const first = urls[0];
    let media_type = 'TEXT';
    const body: any = { access_token: acc.accessToken, text: caption || '' };
    if (first) {
      media_type = first.match(/mp4|mov/i) ? 'VIDEO' : 'IMAGE';
      if (media_type === 'VIDEO') body.video_url = first; else body.image_url = first;
    }
    body.media_type = media_type;
    const c = await axios.post(`https://graph.threads.net/v1.0/${acc.externalId}/threads`, body);
    await sleep(30000);
    const p = await axios.post(`https://graph.threads.net/v1.0/${acc.externalId}/threads_publish`, { creation_id: c.data.id, access_token: acc.accessToken });
    return p.data.id;
  }

  // Replies
  async replyInstagramComment(commentId: string, text: string, token: string) {
    const v = this.v();
    const r = await axios.post(`https://graph.facebook.com/${v}/${commentId}/replies`, { message: text, access_token: token });
    return r.data.id;
  }
  async hideInstagramComment(commentId: string, hide: boolean, token: string) {
    const v = this.v();
    const r = await axios.post(`https://graph.facebook.com/${v}/${commentId}/hide`, { hide, access_token: token });
    return r.data;
  }
  async privateReplyInstagram(igId: string, commentId: string, text: string, token: string) {
    const host = 'https://graph.facebook.com';
    const v = this.v();
    const r = await axios.post(`${host}/${v}/${igId}/messages`, { recipient: { comment_id: commentId }, message: { text }, access_token: token });
    return r.data;
  }
  async replyFacebookComment(commentId: string, text: string, token: string) {
    const v = this.v();
    const r = await axios.post(`https://graph.facebook.com/${v}/${commentId}/comments`, { message: text, access_token: token });
    return r.data.id;
  }
}
