import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RequestContext } from '../tenancy/ctx';
import { verifyToken } from './crypto';

export type AuthUser = { id: string; email: string; role: Role };

const IS_PUBLIC = 'isPublic';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/** Opts a route (or controller) out of the global session check. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user, as attached by AuthGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/**
 * Global guard: every route needs a valid `Authorization: Bearer <session token>` unless marked @Public().
 * It also decides which client the request is about (see RequestContext):
 *   - a client user is always limited to their own client; sending X-Client-Id is refused;
 *   - an admin acts on the client named in X-Client-Id, or on their own home workspace without it;
 *   - X-Preview-Mode: view makes an admin's act-as requests read only.
 * The role always comes from the database, never from the token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ec.getHandler(), ec.getClass()])) return true;

    const req = ec.switchToHttp().getRequest();
    const header: string = req.headers?.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = token ? verifyToken(token, 'session') : null;
    if (!payload) throw new UnauthorizedException('Sign in to continue.');

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, status: true, clientId: true, sessionVersion: true, client: { select: { status: true } } },
    });
    if (!user) throw new UnauthorizedException('Sign in to continue.');
    // A password reset or a disabled account bumps the version, which ends every session issued before it. Sessions from
    // before versions existed carry none, and count as version 0.
    if ((typeof payload.sv === 'number' ? payload.sv : 0) !== user.sessionVersion) throw new UnauthorizedException('Sign in to continue.');
    if (user.status === 'DISABLED') throw new UnauthorizedException('This account has been disabled.');
    if (user.status === 'INVITED') throw new UnauthorizedException('Finish setting up your account from your invitation first.');

    const isAdmin = user.role === Role.ADMIN;
    if (!isAdmin && user.client?.status === 'SUSPENDED') {
      throw new ForbiddenException({ statusCode: 403, code: 'CLIENT_SUSPENDED', message: 'This workspace is paused. Contact your account manager.' });
    }

    const actAs = String(req.headers?.['x-client-id'] || '').trim() || null;
    let clientId = user.clientId;
    let acting = false;
    if (actAs) {
      if (!isAdmin) throw new ForbiddenException({ statusCode: 403, code: 'ACT_AS_FORBIDDEN', message: 'Not allowed.' });
      if (actAs !== user.clientId) {
        const target = await this.prisma.client.findFirst({ where: { id: actAs, archivedAt: null }, select: { id: true } });
        if (!target) throw new NotFoundException('Not found.');
        acting = true;
      }
      clientId = actAs;
    }

    const readOnlyPreview = acting && String(req.headers?.['x-preview-mode'] || '').toLowerCase() === 'view';
    if (readOnlyPreview && !SAFE_METHODS.includes(String(req.method).toUpperCase())) {
      throw new ForbiddenException({ statusCode: 403, code: 'PREVIEW_READ_ONLY', message: 'This preview is read only. Turn on admin controls to make changes.' });
    }

    const authUser: AuthUser = { id: user.id, email: user.email, role: user.role };
    const ctx: RequestContext = { user: authUser, clientId, acting, readOnlyPreview };
    req.user = authUser;
    req.ctx = ctx;
    return true;
  }
}
