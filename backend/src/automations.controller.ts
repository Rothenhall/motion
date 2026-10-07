import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Ctx, RequestContext, accountScope, clientScope } from './tenancy/ctx';
import { RequireFeature } from './tenancy/guards';

const TRIGGERS = ['COMMENT_KEYWORD', 'ALL_COMMENTS'];
const REPLY_MODES = ['PUBLIC', 'DM', 'PUBLIC_AND_DM'];
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

@Controller('automations')
@RequireFeature('automations')
export class AutomationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.prisma.automationRule.findMany({ where: accountScope(ctx), orderBy: { createdAt: 'desc' }, include: { account: { select: accountSelect } } });
  }

  @Post()
  async create(@Ctx() ctx: RequestContext, @Body() body: { accountId?: string; name?: string; trigger?: string; keyword?: string; replyMode?: string; publicReply?: string; dmText?: string }) {
    const accountId = body.accountId?.trim();
    const name = body.name?.trim();
    const trigger = body.trigger || 'COMMENT_KEYWORD';
    const replyMode = body.replyMode || 'PUBLIC_AND_DM';
    if (!accountId || !name) throw new BadRequestException('An account and rule name are required.');
    if (!TRIGGERS.includes(trigger)) throw new BadRequestException('Choose a supported trigger.');
    if (!REPLY_MODES.includes(replyMode)) throw new BadRequestException('Choose a supported reply mode.');
    if (trigger === 'COMMENT_KEYWORD' && !body.keyword?.trim()) throw new BadRequestException('Add a keyword for this trigger.');
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, ...clientScope(ctx), disconnectedAt: null }, select: { id: true } });
    if (!account) throw new BadRequestException('That account is no longer connected.');

    return this.prisma.automationRule.create({
      data: {
        accountId,
        name,
        trigger,
        keyword: body.keyword?.trim() || null,
        replyMode,
        publicReply: body.publicReply?.trim() || null,
        dmText: body.dmText?.trim() || null,
      },
      include: { account: { select: accountSelect } },
    });
  }

  @Patch(':id/toggle')
  async toggle(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id, ...accountScope(ctx) }, select: { isActive: true } });
    if (!rule) throw new NotFoundException('Automation not found.');
    return this.prisma.automationRule.update({ where: { id }, data: { isActive: !rule.isActive }, include: { account: { select: accountSelect } } });
  }

  @Delete(':id')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id, ...accountScope(ctx) }, select: { id: true } });
    if (!rule) throw new NotFoundException('Automation not found.');
    return this.prisma.automationRule.delete({ where: { id } });
  }
}
