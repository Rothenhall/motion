import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Ctx, RequestContext, clientScope, requireClient } from './tenancy/ctx';
import { encryptToken } from './auth/crypto';

const PROVIDERS = ['facebook_page', 'instagram', 'threads'];
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true, updatedAt: true } as const;

@Controller('accounts')
export class AccountsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.prisma.socialAccount.findMany({ where: clientScope(ctx), orderBy: { createdAt: 'desc' }, select: accountSelect });
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() body: { provider?: string; externalId?: string; name?: string; accessToken?: string; tokenExpires?: string }) {
    const provider = body.provider?.trim();
    const externalId = body.externalId?.trim();
    const accessToken = body.accessToken?.trim();
    if (!provider || !PROVIDERS.includes(provider)) throw new BadRequestException('Choose a supported provider.');
    if (!externalId) throw new BadRequestException('An external account ID is required.');
    if (!accessToken) throw new BadRequestException('An access token is required.');

    const tokenExpires = body.tokenExpires ? new Date(body.tokenExpires) : undefined;
    if (tokenExpires && Number.isNaN(tokenExpires.getTime())) throw new BadRequestException('Token expiry must be a valid date.');

    return this.prisma.socialAccount.create({
      data: { userId: ctx.user.id, clientId: requireClient(ctx), provider, externalId, name: body.name?.trim() || null, accessToken: encryptToken(accessToken), tokenExpires },
      select: accountSelect,
    });
  }

  @Delete(':id')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id, ...clientScope(ctx) }, select: { id: true } });
    if (!account) throw new NotFoundException('Account not found.');
    return this.prisma.socialAccount.delete({ where: { id }, select: accountSelect });
  }
}
