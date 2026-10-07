import { Body, Controller, HttpCode, NotFoundException, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma.service';
import { AUTH_LIMIT } from '../rate-limit';
import { AuditService } from '../tenancy/audit.service';
import { Public } from './auth.guard';
import { InvitesService } from './invites.service';
import { sessionFor } from './session';

// One answer for every way a link can be bad (wrong, used, expired, belonging to a disabled user), so nothing is revealed.
const invalid = (code: string) => new NotFoundException({ statusCode: 404, code, message: 'This link is not valid any more. Ask your account manager for a new one.' });

/** The public side of invitations and password resets: check a link, then use it to set a password and sign in. */
@Controller('auth')
export class InvitesController {
  constructor(private invites: InvitesService, private prisma: PrismaService, private audit: AuditService) {}

  /** Read only: tells the page whose invitation this is, without using it up. */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('accept-invite/validate')
  @HttpCode(200)
  async validateInvite(@Body() body: { token?: string }) {
    const row = await this.invites.inspect(body.token, 'INVITE');
    if (!row) throw invalid('INVITE_INVALID');
    return { email: row.user.email, clientName: row.user.client?.name ?? null, role: row.user.role };
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(@Body() body: { token?: string; password?: string }) {
    const user = await this.invites.redeem(body.token, 'INVITE', body.password || '');
    if (!user) throw invalid('INVITE_INVALID');
    await this.audit.record(user.id, 'user.accept_invite', { clientId: user.clientId, targetType: 'user', targetId: user.id });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return sessionFor(user);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password/validate')
  @HttpCode(200)
  async validateReset(@Body() body: { token?: string }) {
    const row = await this.invites.inspect(body.token, 'RESET');
    if (!row) throw invalid('RESET_INVALID');
    return { email: row.user.email };
  }

  /** Sets a new password, signs out every older session (the version is bumped), and signs this one in. */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: { token?: string; password?: string }) {
    const user = await this.invites.redeem(body.token, 'RESET', body.password || '');
    if (!user) throw invalid('RESET_INVALID');
    await this.audit.record(user.id, 'user.reset_password', { clientId: user.clientId, targetType: 'user', targetId: user.id });
    return sessionFor(user);
  }
}
