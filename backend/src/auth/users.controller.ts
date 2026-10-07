import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AUTH_LIMIT } from '../rate-limit';
import { Ctx, RequestContext } from '../tenancy/ctx';
import { FeaturesService } from '../tenancy/features.service';
import { workspaceName } from '../tenancy/clients.service';
import { Public } from './auth.guard';
import { hashPassword, signToken, verifyPassword } from './crypto';

const SESSION_TTL = 7 * 24 * 60 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Motion user accounts: email + password, stateless signed session tokens. */
@Controller('auth')
export class UsersController {
  constructor(private prisma: PrismaService, private features: FeaturesService) {}

  private session(user: { id: string; email: string; role: Role }) {
    return { token: signToken(user.id, 'session', SESSION_TTL), user: { id: user.id, email: user.email, role: user.role } };
  }

  /**
   * Open sign-up for now. The very first account becomes an admin (and takes over any channels connected before accounts
   * existed). Everyone after that is a client user with a workspace of their own, never an admin. Set ALLOW_SIGNUP=false
   * to close sign-up once clients are invited instead.
   */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('register')
  async register(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password || '';
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (password.length < 8) throw new BadRequestException('Use a password of at least 8 characters.');
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with that email already exists.');
    }

    const isFirstUser = (await this.prisma.user.count()) === 0;
    if (!isFirstUser && process.env.ALLOW_SIGNUP === 'false') throw new ForbiddenException('Sign-up is by invitation. Ask your account manager.');

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const client = await tx.client.create({ data: { name: workspaceName(email) } });
      await tx.clientFeatureFlag.create({ data: { clientId: client.id, featureKey: 'ai', enabled: true } });
      const created = await tx.user.create({ data: { email, passwordHash, role: isFirstUser ? Role.ADMIN : Role.CLIENT_POC, clientId: client.id } });
      await tx.client.update({ where: { id: client.id }, data: { createdById: created.id } });
      // Channels connected before accounts existed belong to whoever sets up the workspace first.
      if (isFirstUser) await tx.socialAccount.updateMany({ where: { userId: null }, data: { userId: created.id, clientId: client.id } });
      return created;
    });
    return this.session(user);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim().toLowerCase() || '';
    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(body.password || '', user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    return this.session(user);
  }

  /** Who is signed in, which client they are looking at, and what is switched on for it. The app builds its menu from this. */
  @Get('me')
  async me(@Ctx() ctx: RequestContext) {
    const client = ctx.clientId ? await this.prisma.client.findUnique({ where: { id: ctx.clientId }, select: { id: true, name: true, status: true } }) : null;
    const features = ctx.clientId ? await this.features.forClient(ctx.clientId) : null;
    return {
      id: ctx.user.id,
      email: ctx.user.email,
      role: ctx.user.role,
      client,
      features,
      acting: ctx.acting,
      readOnlyPreview: ctx.readOnlyPreview,
      canActAs: ctx.user.role === Role.ADMIN,
    };
  }
}
