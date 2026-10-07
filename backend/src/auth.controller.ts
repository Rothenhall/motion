import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MetaService } from './meta.service';
import { InsightsService } from './insights.service';
import { Public } from './auth/auth.guard';
import { PrismaService } from './prisma.service';
import { Ctx, RequestContext, requireClient } from './tenancy/ctx';
import { ChannelOwner } from './meta.service';
import { signToken, verifyToken } from './auth/crypto';
import { frontendUrl } from './frontend-url';
import { graphVersion } from './meta-config';
import { AuditService } from './tenancy/audit.service';
import { Roles } from './tenancy/guards';

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
  constructor(private meta: MetaService, private insights: InsightsService, private prisma: PrismaService, private audit: AuditService) {}

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
  @Roles(Role.ADMIN)
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
    // Only staff connect channels. They may have been demoted or disabled since the link was made, so ask again.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true, status: true, clientId: true } });
    if (!user || user.role !== Role.ADMIN || user.status !== 'ACTIVE') return null;
    // Links started before clients existed carry no client: use the user's own workspace.
    const clientId = typeof payload.clientId === 'string' ? payload.clientId : user.clientId;
    if (!clientId || !(await this.prisma.client.findFirst({ where: { id: clientId, archivedAt: null }, select: { id: true } }))) return null;
    return { userId: payload.sub, clientId };
  }

  // OAuth callbacks auto-connect: exchange -> long-lived token -> profile ->
  // stored account -> recent history import. The user just lands back connected.
  private done(res: any, provider: string, label: string, owner: ChannelOwner) {
    void this.audit.record(owner.userId, 'channel.connect', { clientId: owner.clientId, targetType: 'channel', meta: { provider, label } });
    // Pull first insights for this client's channels in the background so Analytics has data by the time they look.
    this.insights.syncClient(owner.clientId).catch(() => undefined);
    return res.redirect(`${frontendUrl()}/admin/clients/${encodeURIComponent(owner.clientId)}?tab=channels&connected=${encodeURIComponent(provider)}&account=${encodeURIComponent(label)}`);
  }

  /**
   * Back to the client's Channels tab with the reason. The client comes from the owner when we have one, or from the signed
   * state when it can still be read (for example the person cancelled on Meta). Otherwise the admin home shows the message.
   */
  private fail(res: any, err: unknown, owner?: ChannelOwner | null, state?: string) {
    const payload = state ? verifyToken(state, 'oauth_state') : null;
    const clientId = owner?.clientId ?? (typeof payload?.clientId === 'string' ? payload.clientId : null);
    const error = `error=${encodeURIComponent(this.meta.msg(err))}`;
    const base = frontendUrl();
    return res.redirect(clientId ? `${base}/admin/clients/${encodeURIComponent(clientId)}?tab=channels&${error}` : `${base}/admin?${error}`);
  }

  @Public()
  @Get('facebook/callback')
  async fbCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Facebook authorization was cancelled.'), null, state);
    const owner = await this.stateOwner(state, 'facebook');
    if (!owner) return this.fail(res, new Error(EXPIRED), null, state);
    try {
      const r = await this.meta.connectFacebook(code, owner);
      const label = r.count > 1 ? `${r.count} Pages` : r.name;
      return this.done(res, 'facebook', label, owner);
    } catch (e) {
      return this.fail(res, e, owner, state);
    }
  }
  @Public()
  @Get('instagram/callback')
  async igCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Instagram authorization was cancelled.'), null, state);
    const owner = await this.stateOwner(state, 'instagram');
    if (!owner) return this.fail(res, new Error(EXPIRED), null, state);
    try {
      const r = await this.meta.connectInstagram(code, owner);
      return this.done(res, 'instagram', r.name, owner);
    } catch (e) {
      return this.fail(res, e, owner, state);
    }
  }
  @Public()
  @Get('threads/callback')
  async thCb(@Query('code') code: string, @Query('state') state: string, @Res() res: any) {
    if (!code) return this.fail(res, new Error('Threads authorization was cancelled.'), null, state);
    const owner = await this.stateOwner(state, 'threads');
    if (!owner) return this.fail(res, new Error(EXPIRED), null, state);
    try {
      const r = await this.meta.connectThreads(code, owner);
      return this.done(res, 'threads', r.name, owner);
    } catch (e) {
      return this.fail(res, e, owner, state);
    }
  }

}
