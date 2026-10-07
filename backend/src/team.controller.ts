import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeamService, userView } from './auth/team.service';
import { AuditService } from './tenancy/audit.service';
import { Ctx, RequestContext, requireClient } from './tenancy/ctx';

/**
 * A client's own people. The main contact (or staff acting as the client) can invite members within the seat limit and
 * pause or restore them. Members cannot, and nobody here can touch the main contact or staff: that is for the agency.
 */
@Controller('team')
export class TeamController {
  constructor(private team: TeamService, private audit: AuditService) {}

  private manage(ctx: RequestContext): string {
    if (ctx.user.role === Role.CLIENT_MEMBER) throw new ForbiddenException({ statusCode: 403, code: 'TEAM_FORBIDDEN', message: 'Only the main contact can manage the team.' });
    return requireClient(ctx);
  }

  @Get('members')
  members(@Ctx() ctx: RequestContext) {
    return this.team.members(this.manage(ctx));
  }

  @Post('invite')
  async invite(@Ctx() ctx: RequestContext, @Body() body: { email?: string }) {
    const clientId = this.manage(ctx);
    const invite = await this.team.invite(clientId, body.email || '', Role.CLIENT_MEMBER, ctx.user.id);
    await this.audit.record(ctx.user.id, 'user.invite', { clientId, targetType: 'user', targetId: invite.user.id, meta: { email: invite.user.email, role: 'CLIENT_MEMBER' } });
    return { user: userView(invite.user), invite: { email: invite.user.email, url: invite.url, expiresAt: invite.expiresAt } };
  }

  @Post('users/:id/resend-invite')
  @HttpCode(200)
  async resend(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.find(this.manage(ctx), id, [Role.CLIENT_MEMBER]);
    const link = await this.team.resend(user, ctx.user.id);
    await this.audit.record(ctx.user.id, 'user.resend_invite', { clientId: user.clientId, targetType: 'user', targetId: id });
    return { invite: { email: user.email, url: link.url, expiresAt: link.expiresAt } };
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  async disable(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.disable(await this.team.find(this.manage(ctx), id, [Role.CLIENT_MEMBER]));
    await this.audit.record(ctx.user.id, 'user.disable', { clientId: user.clientId, targetType: 'user', targetId: id });
    return userView(user);
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  async enable(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.enable(await this.team.find(this.manage(ctx), id, [Role.CLIENT_MEMBER]));
    await this.audit.record(ctx.user.id, 'user.enable', { clientId: user.clientId, targetType: 'user', targetId: id });
    return userView(user);
  }
}
