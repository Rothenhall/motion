import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AUTH_LIMIT } from '../rate-limit';
import { Ctx, RequestContext } from '../tenancy/ctx';
import { FeaturesService } from '../tenancy/features.service';
import { workspaceName } from '../tenancy/clients.service';
import { Public } from './auth.guard';
import { hashPassword, verifyPassword } from './crypto';
import { hasPassword } from './invites.service';
import { sessionFor } from './session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FAILED = 5; // wrong passwords in a row before the account is locked
const LOCK_MS = 15 * 60_000;

// Checked against when the email is unknown, so "no such account" takes as long as "wrong password".
let dummyHash: Promise<string> | null = null;
const decoy = () => (dummyHash ??= hashPassword('not-a-real-password'));

/** Motion user accounts: email + password, stateless signed session tokens. */
@Controller('auth')
export class UsersController {
  constructor(private prisma: PrismaService, private features: FeaturesService) {}

  /**
   * Sign-up is closed: people join by invitation. The one exception is the very first account on an empty database,
   * which becomes an admin (and takes over any channels connected before accounts existed). Set ALLOW_SIGNUP=true to
   * reopen open sign-up, where everyone gets a workspace of their own and never admin rights.
   */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('register')
  async register(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim().toLowerCase();
    const password = body.password || '';
    if (!email || !EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (password.length < 8) throw new BadRequestException('Use a password of at least 8 characters.');

    const isFirstUser = (await this.prisma.user.count()) === 0;
    if (!isFirstUser && process.env.ALLOW_SIGNUP !== 'true') throw new ForbiddenException('Sign-up is by invitation. Ask your account manager.');
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('An account with that email already exists.');
    }

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
    return sessionFor(user);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    const fail = () => new UnauthorizedException('Email or password is incorrect.');
    const email = body.email?.trim().toLowerCase() || '';
    const password = body.password || '';
    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (!user) {
      await verifyPassword(password, await decoy());
      throw fail();
    }
    // Someone invited but with no password yet has nothing to match; check against the decoy so it still takes as long.
    const correct = await verifyPassword(password, hasPassword(user.passwordHash) ? user.passwordHash : await decoy());
    // A locked account refuses even the right password until the lock ends, with the same answer as a wrong one.
    if (user.lockedUntil && user.lockedUntil > new Date()) throw fail();
    if (user.status !== 'ACTIVE') throw fail();
    if (!correct) {
      const failed = user.failedAttempts + 1;
      await this.prisma.user.update({ where: { id: user.id }, data: failed >= MAX_FAILED ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedAttempts: failed } });
      throw fail();
    }
    const signedIn = await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    return sessionFor(signedIn);
  }

  /** Ends every session this user has, on every device, including the one making the request. */
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Ctx() ctx: RequestContext) {
    await this.prisma.user.update({ where: { id: ctx.user.id }, data: { sessionVersion: { increment: 1 } } });
  }

  /** Who is signed in, which client they are looking at, and what is switched on for it. The app builds its menu from this. */
  @Get('me')
  async me(@Ctx() ctx: RequestContext) {
    const client = ctx.clientId ? await this.prisma.client.findUnique({ where: { id: ctx.clientId }, select: { id: true, name: true, status: true, requireApproval: true } }) : null;
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
