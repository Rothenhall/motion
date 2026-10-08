import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { assertChannelFree } from './tenancy/channel-rules';
import axios from 'axios';
import { PrismaService } from './prisma.service';
import { decryptToken, encryptToken, isEncryptedToken } from './auth/crypto';
import { graphVersion } from './meta-config';

const DAY = 86_400_000;

/**
 * Owns everything Meta: OAuth auto-connect (exchange -> long-lived token ->
 * profile -> stored account -> history import) plus nightly token refresh.
 * Callers never touch tokens directly — one click in, connected account out.
 * Tokens are stored encrypted; decrypt with decryptToken() right before use.
 */
/** Who a connected channel belongs to: the client workspace, and the user who connected it. */
export type ChannelOwner = { userId: string; clientId: string };

@Injectable()
export class MetaService implements OnModuleInit {
  private readonly log = new Logger(MetaService.name);

  constructor(private prisma: PrismaService) {}

  /** Encrypts any access tokens still stored as plaintext from before encryption at rest. */
  async onModuleInit() {
    const plain = await this.prisma.socialAccount.findMany({ select: { id: true, accessToken: true } });
    const pending = plain.filter((a) => !isEncryptedToken(a.accessToken));
    for (const a of pending) {
      await this.prisma.socialAccount.update({ where: { id: a.id }, data: { accessToken: encryptToken(a.accessToken) } });
    }
    if (pending.length) this.log.log(`Encrypted ${pending.length} stored access token(s).`);
  }

  private v() {
    return graphVersion();
  }

  // ---------- Instagram (Business Login) ----------

  async connectInstagram(code: string, owner: ChannelOwner): Promise<{ name: string; imported: number }> {
    const clientId = process.env.META_IG_APP_ID || process.env.META_APP_ID!;
    const clientSecret = process.env.META_IG_APP_SECRET || process.env.META_APP_SECRET!;
    const redirect = process.env.META_IG_REDIRECT_URL!;

    const short = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirect,
        code,
      }),
    );

    const long = await axios.get('https://graph.instagram.com/access_token', {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: clientSecret,
        // Documented as { data: [{ access_token, user_id, permissions }] }; often returned flat.
        access_token: short.data?.data?.[0]?.access_token ?? short.data?.access_token,
      },
    });
    const token: string = long.data.access_token;
    const expiresAt = new Date(Date.now() + (long.data.expires_in ?? 5_184_000) * 1000);

    const me = await axios.get('https://graph.instagram.com/me', {
      params: { fields: 'user_id,username,account_type,media_count', access_token: token },
    });
    const externalId = String(me.data.user_id ?? me.data.id);
    const account = await this.upsert(owner, 'instagram', externalId, me.data.username ? `@${me.data.username}` : null, token, expiresAt, {
      username: me.data.username,
      accountType: me.data.account_type,
      mediaCount: me.data.media_count,
    });
    await this.subscribeInstagram(token);

    const imported = await this.importInstagramMedia(account.id, token).catch((e) => {
      this.log.warn(`IG media import failed: ${this.msg(e)}`);
      return 0;
    });
    return { name: account.name || 'Instagram', imported };
  }

  async importInstagramMedia(accountId: string, token: string): Promise<number> {
    const res = await axios.get('https://graph.instagram.com/me/media', {
      params: { fields: 'id,caption,media_type,timestamp,permalink', limit: 25, access_token: token },
    });
    const items: any[] = res.data?.data ?? [];
    if (!items.length) return 0;
    const existing = await this.prisma.scheduledPost.findMany({
      where: { accountId, externalId: { not: null } },
      select: { externalId: true },
    });
    const seen = new Set(existing.map((p) => p.externalId));
    let n = 0;
    for (const m of items) {
      if (!m?.id || seen.has(m.id)) continue;
      const mediaType = m.media_type === 'VIDEO' ? 'VIDEO' : m.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : 'IMAGE';
      await this.prisma.scheduledPost.create({
        data: {
          accountId,
          platform: 'instagram',
          mediaType,
          caption: m.caption ?? null,
          mediaUrls: '[]',
          scheduledAt: m.timestamp ? new Date(m.timestamp) : new Date(),
          status: 'PUBLISHED',
          externalId: m.id,
          permalink: m.permalink ?? null,
        },
      });
      n++;
    }
    return n;
  }

  // ---------- Facebook Pages ----------

  async connectFacebook(code: string, owner: ChannelOwner): Promise<{ name: string; count: number }> {
    const redirect = process.env.META_FB_REDIRECT_URL!;
    const longToken = await this.longLivedUserToken(code, redirect);
    const pages = await axios.get(`https://graph.facebook.com/${this.v()}/me/accounts`, {
      params: { fields: 'id,name,access_token', access_token: longToken.token },
    });
    const list: any[] = pages.data?.data ?? [];
    if (!list.length) {
      // Say why: an empty list is either no Pages in the grant or a missing pages_show_list permission.
      try {
        const perms = await axios.get(`https://graph.facebook.com/${this.v()}/me/permissions`, { params: { access_token: longToken.token } });
        const granted = (perms.data?.data ?? []).filter((x: any) => x.status === 'granted').map((x: any) => x.permission);
        this.log.warn(`Facebook returned no Pages. Permissions granted: ${granted.join(', ') || 'none'}`);
      } catch (e) {
        this.log.warn(`Facebook returned no Pages and permissions could not be read: ${this.msg(e)}`);
      }
      throw new Error('No Facebook Pages found on this account. Create a Page (or ask an admin to add you), then reconnect.');
    }
    // Check every Page first, so a clash on the last one does not leave the others half connected.
    for (const page of list) await assertChannelFree(this.prisma, 'facebook_page', String(page.id), owner.clientId);
    for (const page of list) {
      // Page tokens don't expire once the user token is long-lived.
      await this.upsert(owner, 'facebook_page', String(page.id), page.name, page.access_token, null, { via: 'auto' });
      await this.subscribePage(String(page.id), page.access_token);
    }
    return { name: list[0].name, count: list.length };
  }

  // ---------- Webhook subscriptions ----------
  // Meta only delivers comment and message webhooks for accounts subscribed to
  // the app, so every connect subscribes. A failure here doesn't block the
  // connection (publishing still works); it is logged and tried again on reconnect.

  /** Needs pages_manage_metadata and a Page token. */
  async subscribePage(pageId: string, pageToken: string) {
    try {
      await axios.post(`https://graph.facebook.com/${this.v()}/${pageId}/subscribed_apps`, null, {
        params: { subscribed_fields: 'feed,messages', access_token: pageToken },
      });
    } catch (e) {
      this.log.warn(`Webhook subscription failed for Page ${pageId}: ${this.msg(e)}`);
    }
  }

  /** Instagram Login: subscribe the account behind the token. */
  async subscribeInstagram(token: string) {
    try {
      await axios.post(`https://graph.instagram.com/${this.v()}/me/subscribed_apps`, null, {
        params: { subscribed_fields: 'comments,messages', access_token: token },
      });
    } catch (e) {
      this.log.warn(`Instagram webhook subscription failed: ${this.msg(e)}`);
    }
  }

  async importFacebookPosts(accountId: string, pageId: string, token: string): Promise<number> {
    const res = await axios.get(`https://graph.facebook.com/${this.v()}/${pageId}/published_posts`, {
      params: { fields: 'id,message,created_time,permalink_url', limit: 25, access_token: token },
    });
    const items: any[] = res.data?.data ?? [];
    if (!items.length) return 0;
    const existing = await this.prisma.scheduledPost.findMany({
      where: { accountId, externalId: { not: null } },
      select: { externalId: true },
    });
    const seen = new Set(existing.map((p) => p.externalId));
    let n = 0;
    for (const p of items) {
      if (!p?.id || seen.has(p.id)) continue;
      await this.prisma.scheduledPost.create({
        data: {
          accountId,
          platform: 'facebook',
          mediaType: 'TEXT',
          caption: p.message ?? null,
          mediaUrls: '[]',
          scheduledAt: p.created_time ? new Date(p.created_time) : new Date(),
          status: 'PUBLISHED',
          externalId: p.id,
          permalink: p.permalink_url ?? null,
        },
      });
      n++;
    }
    return n;
  }

  // ---------- Threads ----------

  /** Threads has its own app ID and secret (Dashboard > Use cases > Threads API > Settings). */
  threadsApp(): { id: string; secret: string } {
    const id = process.env.META_THREADS_APP_ID;
    const secret = process.env.META_THREADS_APP_SECRET;
    if (!id || !secret) throw new Error('Threads is not set up on this server yet (META_THREADS_APP_ID and META_THREADS_APP_SECRET are missing).');
    return { id, secret };
  }

  /** Threads OAuth: code -> short-lived token on graph.threads.net -> 60-day token via th_exchange_token. */
  async threadsToken(code: string): Promise<{ token: string; expiresAt: Date }> {
    const app = this.threadsApp();
    const short = await axios.post(
      'https://graph.threads.net/oauth/access_token',
      new URLSearchParams({
        client_id: app.id,
        client_secret: app.secret,
        grant_type: 'authorization_code',
        redirect_uri: process.env.META_THREADS_REDIRECT_URL!,
        code,
      }),
    );
    const long = await axios.get('https://graph.threads.net/access_token', {
      params: { grant_type: 'th_exchange_token', client_secret: app.secret, access_token: short.data.access_token },
    });
    return {
      token: long.data.access_token,
      expiresAt: new Date(Date.now() + (long.data.expires_in ?? 5_184_000) * 1000),
    };
  }

  async connectThreads(code: string, owner: ChannelOwner): Promise<{ name: string; imported: number }> {
    const longToken = await this.threadsToken(code);
    const me = await axios.get('https://graph.threads.net/v1.0/me', {
      params: { fields: 'id,username', access_token: longToken.token },
    });
    const account = await this.upsert(
      owner,
      'threads',
      String(me.data.id),
      me.data.username ? `@${me.data.username}` : null,
      longToken.token,
      longToken.expiresAt,
      { username: me.data.username },
    );
    const imported = await this.importThreads(account.id, longToken.token).catch((e) => {
      this.log.warn(`Threads import failed: ${this.msg(e)}`);
      return 0;
    });
    return { name: account.name || 'Threads', imported };
  }

  async importThreads(accountId: string, token: string): Promise<number> {
    const res = await axios.get('https://graph.threads.net/v1.0/me/threads', {
      params: { fields: 'id,text,timestamp,permalink', limit: 25, access_token: token },
    });
    const items: any[] = res.data?.data ?? [];
    if (!items.length) return 0;
    const existing = await this.prisma.scheduledPost.findMany({
      where: { accountId, externalId: { not: null } },
      select: { externalId: true },
    });
    const seen = new Set(existing.map((p) => p.externalId));
    let n = 0;
    for (const t of items) {
      if (!t?.id || seen.has(t.id)) continue;
      await this.prisma.scheduledPost.create({
        data: {
          accountId,
          platform: 'threads',
          mediaType: 'TEXT',
          caption: t.text ?? null,
          mediaUrls: '[]',
          scheduledAt: t.timestamp ? new Date(t.timestamp) : new Date(),
          status: 'PUBLISHED',
          externalId: t.id,
          permalink: t.permalink ?? null,
        },
      });
      n++;
    }
    return n;
  }

  // ---------- shared ----------

  private async longLivedUserToken(code: string, redirect: string): Promise<{ token: string; expiresAt: Date }> {
    const appId = process.env.META_APP_ID!;
    const secret = process.env.META_APP_SECRET!;
    const short = await axios.get(`https://graph.facebook.com/${this.v()}/oauth/access_token`, {
      params: { client_id: appId, client_secret: secret, redirect_uri: redirect, code },
    });
    const long = await axios.get(`https://graph.facebook.com/${this.v()}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: short.data.access_token,
      },
    });
    return {
      token: long.data.access_token,
      expiresAt: new Date(Date.now() + (long.data.expires_in ?? 5_184_000) * 1000),
    };
  }

  /** Create-or-update by (client, provider, externalId). Safe to call twice for the same OAuth callback. */
  private async upsert(
    owner: ChannelOwner,
    provider: string,
    externalId: string,
    name: string | null,
    accessToken: string,
    tokenExpires: Date | null,
    meta?: Record<string, unknown>,
  ) {
    // One channel, one client: refuse before touching anything if another client has it connected.
    await assertChannelFree(this.prisma, provider, externalId, owner.clientId);
    // Connecting again also brings back a channel that staff had disconnected.
    const data: any = { accessToken: encryptToken(accessToken), tokenExpires, disconnectedAt: null };
    if (name) data.name = name;
    if (meta) data.meta = JSON.stringify(meta);
    try {
      const existing = await this.prisma.socialAccount.findFirst({ where: { clientId: owner.clientId, provider, externalId } });
      if (existing) {
        return await this.prisma.socialAccount.update({ where: { id: existing.id }, data });
      }
      return await this.prisma.socialAccount.create({ data: { userId: owner.userId, clientId: owner.clientId, provider, externalId, ...data } });
    } catch (e: any) {
      // Lost a race with a parallel callback (unique client+provider+externalId) — return the winner.
      if (e?.code === 'P2002') {
        await assertChannelFree(this.prisma, provider, externalId, owner.clientId); // lost a race against another client: say so
        const winner = await this.prisma.socialAccount.findFirst({ where: { clientId: owner.clientId, provider, externalId } });
        if (winner) return winner;
      }
      throw e;
    }
  }

  /** Nightly: refresh tokens expiring within 7 days so accounts never silently disconnect. */
  @Cron('0 4 * * *')
  async refreshExpiringTokens() {
    const soon = new Date(Date.now() + 7 * DAY);
    const expiring = await this.prisma.socialAccount.findMany({ where: { tokenExpires: { lt: soon }, disconnectedAt: null } });
    for (const a of expiring) {
      try {
        const current = decryptToken(a.accessToken);
        if (a.provider === 'instagram') {
          const r = await axios.get('https://graph.instagram.com/refresh_access_token', {
            params: { grant_type: 'ig_refresh_token', access_token: current },
          });
          await this.prisma.socialAccount.update({
            where: { id: a.id },
            data: { accessToken: encryptToken(r.data.access_token), tokenExpires: new Date(Date.now() + (r.data.expires_in ?? 5_184_000) * 1000) },
          });
          this.log.log(`Refreshed Instagram token for ${a.name || a.externalId}`);
        } else if (a.provider === 'threads') {
          const r = await axios.get('https://graph.threads.net/refresh_access_token', {
            params: { grant_type: 'th_refresh_token', access_token: current },
          });
          await this.prisma.socialAccount.update({
            where: { id: a.id },
            data: { accessToken: encryptToken(r.data.access_token), tokenExpires: new Date(Date.now() + (r.data.expires_in ?? 5_184_000) * 1000) },
          });
          this.log.log(`Refreshed Threads token for ${a.name || a.externalId}`);
        } else {
          const r = await axios.get(`https://graph.facebook.com/${this.v()}/oauth/access_token`, {
            params: {
              grant_type: 'fb_exchange_token',
              client_id: process.env.META_APP_ID!,
              client_secret: process.env.META_APP_SECRET!,
              fb_exchange_token: current,
            },
          });
          await this.prisma.socialAccount.update({
            where: { id: a.id },
            data: { accessToken: encryptToken(r.data.access_token), tokenExpires: new Date(Date.now() + (r.data.expires_in ?? 5_184_000) * 1000) },
          });
          this.log.log(`Refreshed ${a.provider} token for ${a.name || a.externalId}`);
        }
      } catch (e) {
        this.log.warn(`Token refresh failed for ${a.name || a.externalId}: ${this.msg(e)}`);
      }
    }
  }

  /** Short, user-safe error text — never leaks secrets. */
  msg(e: any): string {
    return (
      e?.response?.data?.error?.message ||
      e?.response?.data?.error ||
      e?.response?.data?.error_message ||
      e?.message ||
      'Something went wrong talking to Meta. Please try again.'
    );
  }
}
