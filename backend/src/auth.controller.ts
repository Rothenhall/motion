import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import axios from 'axios';
import { MetaService } from './meta.service';
import { InsightsService } from './insights.service';
import { Public } from './auth/auth.guard';
import { PrismaService } from './prisma.service';
import { Ctx, RequestContext, requireClient } from './tenancy/ctx';
import { ChannelOwner } from './meta.service';
import { signToken, verifyToken } from './auth/crypto';
import { graphVersion } from './meta-config';

const OAUTH_STATE_TTL = 10 * 60;
const EXPIRED = 'This connection link expired or was not started from Motion. Please try connecting again.';

// pages_manage_engagement: reply to comments as the Page.
// pages_manage_metadata: subscribe the Page to webhooks (subscribed_apps).
const FB_SCOPES = [
  'pages_show_list','pages_read_engagement','pages_manage_posts','pages_manage_engagement',
  'pages_manage_metadata','pages_messaging','pages_read_user_content','read_insights',
].join(',');

// Business Login for Instagram — IG only, no Facebook required for the end user.
const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_business_manage_insights',
].join(',');

const THREADS_SCOPES = ['threads_basic','threads_content_publish','threads_manage_insights'].join(',');

@Controller('auth')
export class AuthController {
  constructor(private meta: MetaService, private insights: InsightsService, private prisma: PrismaService) {}

  private redirectFor(kind: string) {
    const map: any = {
      facebook: process.env.META_FB_REDIRECT_URL,
      instagram: process.env.META_IG_REDIRECT_URL,
      threads: process.env.META_THREADS_REDIRECT_URL,
    };
    return map[kind] || process.env.META_OAUTH_REDIRECT_URL!;
  }

  /**
   * Returns the Meta authorize URL for the signed-in user. The `state` param is a
   * short-lived signed token naming that user, so the public callback knows whose
   * workspace to attach the channel to and rejects forged or replayed callbacks.
   */
  @Get(':provider/start')
  start(@Ctx() ctx: RequestContext, @Param('provider') provider: string) {
    if (!['facebook', 'instagram', 'threads'].includes(provider)) throw new BadRequestException('Choose Facebook, Instagram or Threads.');
    // The state names the user and the client the channel will belong to, so the public callback needs no session.
    const state = signToken(ctx.user.id, 'oauth_state', OAUTH_STATE_TTL, { provider, clientId: requireClient(ctx) });
    const v = graphVersion();
    if (provider === 'threads') {
      // Threads OAuth runs on threads.net with the Threads app ID, not the Facebook dialog.
      let clientId: string;
      try {
        clientId = this.meta.threadsApp().id;
      } catch (e) {
        throw new BadRequestException(this.meta.msg(e));
      }
      return {
        url:
          `https://threads.net/oauth/authorize` +
          `?client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(this.redirectFor('threads'))}` +
          `&scope=${encodeURIComponent(THREADS_SCOPES)}` +
          `&response_type=code` +
          `&state=${encodeURIComponent(state)}`,
      };
    }
    if (provider === 'instagram') {
      // Business Login for Instagram. Instagram App ID from Dashboard > Instagram > API setup with Instagram login.
      // Falls back to META_APP_ID for dev.
      const clientId = process.env.META_IG_APP_ID || process.env.META_APP_ID;
      return {
        url:
          `https://www.instagram.com/oauth/authorize` +
          `?client_id=${clientId}` +
          `&redirect_uri=${encodeURIComponent(this.redirectFor('instagram'))}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(IG_SCOPES)}` +
          `&state=${encodeURIComponent(state)}`,
      };
    }
    return {
      url:
        `https://www.facebook.com/${v}/dialog/oauth` +
        `?client_id=${process.env.META_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(this.redirectFor(provider))}` +
        `&scope=${encodeURIComponent(FB_SCOPES)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}`,
    };
  }

  private async stateOwner(state: string | undefined, provider: string): Promise<ChannelOwner | null> {
    const payload = state ? verifyToken(state, 'oauth_state') : null;
    if (!payload || payload.provider !== provider) return null;
    // Links started before clients existed carry no client: use the user's own workspace.
    let clientId = typeof payload.clientId === 'string' ? payload.clientId : null;
    if (!clientId) clientId = (await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { clientId: true } }))?.clientId ?? null;
    return clientId ? { userId: payload.sub, clientId } : null;
  }

  // OAuth callbacks auto-connect: exchange -> long-lived token -> profile ->
  // stored account -> recent history import. The user just lands back connected.
  private done(res: any, provider: string, label: string, clientId: string) {
    // Pull first insights for this client's channels in the background so Analytics has data by the time they look.
    this.insights.syncClient(clientId).catch(() => undefined);
    return res.redirect(`${process.env.FRONTEND_URL}/connect?connected=${provider}&account=${encodeURIComponent(label)}`);
  }

  private fail(res: any, err: unknown) {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=${encodeURIComponent(this.meta.msg(err))}`);
  }

  @Public()
  @Get('facebook/callback')
  async fbCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Facebook authorization was cancelled.'));
    const owner = await this.stateOwner(state, 'facebook');
    if (!owner) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectFacebook(code, owner);
      const label = r.count > 1 ? `${r.count} Pages` : r.name;
      return this.done(res, 'facebook', label, owner.clientId);
    } catch (e) {
      return this.fail(res, e);
    }
  }
  @Public()
  @Get('instagram/callback')
  async igCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Instagram authorization was cancelled.'));
    const owner = await this.stateOwner(state, 'instagram');
    if (!owner) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectInstagram(code, owner);
      return this.done(res, 'instagram', r.name, owner.clientId);
    } catch (e) {
      return this.fail(res, e);
    }
  }
  @Public()
  @Get('threads/callback')
  async thCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Threads authorization was cancelled.'));
    const owner = await this.stateOwner(state, 'threads');
    if (!owner) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectThreads(code, owner);
      return this.done(res, 'threads', r.name, owner.clientId);
    } catch (e) {
      return this.fail(res, e);
    }
  }

  // Exchange code -> short-lived token server-side (keeps app secret off the client).
  @Post('exchange')
  async exchange(@Body() b: { provider: string; code: string }) {
    if (b.provider === 'instagram') {
      const r = await axios.post('https://api.instagram.com/oauth/access_token', new URLSearchParams({
        client_id: process.env.META_IG_APP_ID || process.env.META_APP_ID!,
        client_secret: process.env.META_IG_APP_SECRET || process.env.META_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectFor('instagram'),
        code: b.code,
      }));
      return r.data; // { access_token, user_id, permissions }
    }
    if (b.provider === 'threads') {
      let app: { id: string; secret: string };
      try {
        app = this.meta.threadsApp();
      } catch (e) {
        throw new BadRequestException(this.meta.msg(e));
      }
      const r = await axios.post('https://graph.threads.net/oauth/access_token', new URLSearchParams({
        client_id: app.id,
        client_secret: app.secret,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectFor('threads'),
        code: b.code,
      }));
      return r.data; // { access_token, user_id }
    }
    // facebook_page: standard Graph code exchange
    const r = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
      params: { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: this.redirectFor('facebook'), code: b.code },
    });
    return r.data;
  }
}
