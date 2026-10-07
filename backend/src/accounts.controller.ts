import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { encryptToken } from './auth/crypto';
import { AuditService } from './tenancy/audit.service';
import { assertChannelFree, isUniqueViolation } from './tenancy/channel-rules';
import { Ctx, RequestContext, clientScope, requireClient } from './tenancy/ctx';
import { Roles } from './tenancy/guards';

const PROVIDERS = ['facebook_page', 'instagram', 'threads'];
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true, updatedAt: true } as const;

/** The acting client's connected channels. Only staff add or disconnect them; clients see what is connected. */
@Controller('accounts')
export class AccountsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.prisma.socialAccount.findMany({ where: { ...clientScope(ctx), disconnectedAt: null }, orderBy: { createdAt: 'desc' }, select: accountSelect });
  }

  /** Staff add a channel by hand with a token they already hold. Adding a channel the client had before reconnects it. */
  @Post()
  @Roles(Role.ADMIN)
  async create(@Ctx() ctx: RequestContext, @Body() body: { provider?: string; externalId?: string; name?: string; accessToken?: string; tokenExpires?: string }) {
    const provider = body.provider?.trim();
    const externalId = body.externalId?.trim();
    const accessToken = body.accessToken?.trim();
    if (!provider || !PROVIDERS.includes(provider)) throw new BadRequestException('Choose a supported provider.');
    if (!externalId) throw new BadRequestException('An external account ID is required.');
    if (!accessToken) throw new BadRequestException('An access token is required.');

    const tokenExpires = body.tokenExpires ? new Date(body.tokenExpires) : undefined;
    if (tokenExpires && Number.isNaN(tokenExpires.getTime())) throw new BadRequestException('Token expiry must be a valid date.');

    const clientId = requireClient(ctx);
    await assertChannelFree(this.prisma, provider, externalId, clientId);
    const data = { userId: ctx.user.id, name: body.name?.trim() || undefined, accessToken: encryptToken(accessToken), tokenExpires: tokenExpires ?? null, disconnectedAt: null };
    try {
      const existing = await this.prisma.socialAccount.findFirst({ where: { clientId, provider, externalId }, select: { id: true } });
      const account = existing
        ? await this.prisma.socialAccount.update({ where: { id: existing.id }, data, select: accountSelect })
        : await this.prisma.socialAccount.create({ data: { ...data, clientId, provider, externalId, name: data.name ?? null }, select: accountSelect });
      await this.audit.record(ctx.user.id, 'channel.connect', { clientId, targetType: 'channel', targetId: account.id, meta: { provider, manual: true } });
      return account;
    } catch (e) {
      if (isUniqueViolation(e)) await assertChannelFree(this.prisma, provider, externalId, clientId); // lost a race with another connect: say where it went
      throw e;
    }
  }

  /**
   * Disconnects a channel. Its history stays (posts, analytics, comments); publishing, syncing and automations stop, and
   * the stored token is dropped. Connecting the same channel to the same client again brings it back.
   */
  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id, ...clientScope(ctx), disconnectedAt: null }, select: { id: true, provider: true } });
    if (!account) throw new NotFoundException('Account not found.');
    const done = await this.prisma.socialAccount.update({ where: { id }, data: { disconnectedAt: new Date(), accessToken: encryptToken('disconnected'), tokenExpires: null }, select: accountSelect });
    await this.audit.record(ctx.user.id, 'channel.disconnect', { clientId: ctx.clientId, targetType: 'channel', targetId: id, meta: { provider: account.provider } });
    return done;
  }
}
