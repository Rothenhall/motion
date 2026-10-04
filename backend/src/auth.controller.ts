import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import axios from 'axios';
import { MetaService } from './meta.service';
import { InsightsService } from './insights.service';
import { AuthUser, CurrentUser, Public } from './auth/auth.guard';
import { signToken, verifyToken } from './auth/crypto';

const OAUTH_STATE_TTL = 10 * 60;
const EXPIRED = 'This connection link expired or was not started from Motion. Please try connecting again.';

const FB_SCOPES = [
  'pages_show_list','pages_read_engagement','pages_manage_posts',
  'pages_messaging','pages_read_user_content','read_insights',
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
  constructor(private meta: MetaService, private insights: InsightsService) {}

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
  start(@CurrentUser() user: AuthUser, @Param('provider') provider: string) {
    if (!['facebook', 'instagram', 'threads'].includes(provider)) throw new BadRequestException('Choose Facebook, Instagram or Threads.');
    const state = signToken(user.id, 'oauth_state', OAUTH_STATE_TTL, { provider });
    const v = process.env.META_GRAPH_VERSION || 'v22.0';
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
        `&scope=${encodeURIComponent(provider === 'threads' ? THREADS_SCOPES : FB_SCOPES)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}`,
    };
  }

  private stateUser(state: string | undefined, provider: string): string | null {
    const payload = state ? verifyToken(state, 'oauth_state') : null;
    return payload && payload.provider === provider ? payload.sub : null;
  }

  // OAuth callbacks auto-connect: exchange -> long-lived token -> profile ->
  // stored account -> recent history import. The user just lands back connected.
  private done(res: any, provider: string, label: string) {
    // Pull first insights in the background so Analytics has data by the time they look.
    this.insights.syncAll().catch(() => undefined);
    return res.redirect(`${process.env.FRONTEND_URL}/connect?connected=${provider}&account=${encodeURIComponent(label)}`);
  }

  private fail(res: any, err: unknown) {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=${encodeURIComponent(this.meta.msg(err))}`);
  }

  @Public()
  @Get('facebook/callback')
  async fbCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Facebook authorization was cancelled.'));
    const userId = this.stateUser(state, 'facebook');
    if (!userId) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectFacebook(code, userId);
      const label = r.count > 1 ? `${r.count} Pages` : r.name;
      return this.done(res, 'facebook', label);
    } catch (e) {
      return this.fail(res, e);
    }
  }
  @Public()
  @Get('instagram/callback')
  async igCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Instagram authorization was cancelled.'));
    const userId = this.stateUser(state, 'instagram');
    if (!userId) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectInstagram(code, userId);
      return this.done(res, 'instagram', r.name);
    } catch (e) {
      return this.fail(res, e);
    }
  }
  @Public()
  @Get('threads/callback')
  async thCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Threads authorization was cancelled.'));
    const userId = this.stateUser(state, 'threads');
    if (!userId) return this.fail(res, new Error(EXPIRED));
    try {
      const r = await this.meta.connectThreads(code, userId);
      return this.done(res, 'threads', r.name);
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
    // facebook_page + threads: standard Graph code exchange
    const v = process.env.META_GRAPH_VERSION || 'v22.0';
    const redirect = this.redirectFor(b.provider === 'threads' ? 'threads' : 'facebook');
    const r = await axios.get(`https://graph.facebook.com/${v}/oauth/access_token`, {
      params: { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: redirect, code: b.code },
    });
    return r.data;
  }
}
