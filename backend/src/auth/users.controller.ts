import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma.service';
import { AUTH_LIMIT } from '../rate-limit';
import { AuthUser, CurrentUser, Public } from './auth.guard';
import { hashPassword, signToken, verifyPassword } from './crypto';

const SESSION_TTL = 7 * 24 * 60 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Motion user accounts: email + password, stateless signed session tokens. */
@Controller('auth')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  private session(user: { id: string; email: string }) {
    return { token: signToken(user.id, 'session', SESSION_TTL), user: { id: user.id, email: user.email } };
  }

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
    const user = await this.prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
    // Channels connected before accounts existed belong to whoever sets up the workspace first.
    if (isFirstUser) await this.prisma.socialAccount.updateMany({ where: { userId: null }, data: { userId: user.id } });
    return this.session(user);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    const email = body.email?.trim().toLowerCase() || '';
    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (!user || !(await verifyPassword(body.password || '', user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    return this.session(user);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
