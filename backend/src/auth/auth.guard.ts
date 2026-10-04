import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma.service';
import { verifyToken } from './crypto';

export type AuthUser = { id: string; email: string };

const IS_PUBLIC = 'isPublic';

/** Opts a route (or controller) out of the global session check. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user, as attached by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/** Global guard: every route needs a valid `Authorization: Bearer <session token>` unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers?.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = token ? verifyToken(token, 'session') : null;
    if (!payload) throw new UnauthorizedException('Sign in to continue.');

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true } });
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    req.user = user;
    return true;
  }
}
