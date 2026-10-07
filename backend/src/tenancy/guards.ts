import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { FeatureKey } from './features.constants';
import { FeaturesService } from './features.service';
import { RequestContext } from './ctx';

const ROLES = 'roles';
const FEATURES = 'requiredFeatures';

/** Only these roles may call the route. Everyone else is told it does not exist. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The route needs these switches on for the client. Admins are never blocked by switches. */
export const RequireFeature = (...keys: FeatureKey[]) => SetMetadata(FEATURES, keys);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ec: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ec.getHandler(), ec.getClass()]);
    if (!roles?.length) return true;
    const ctx: RequestContext | undefined = ec.switchToHttp().getRequest().ctx;
    // 404 and not 403, so the admin area does not show up for people who cannot use it.
    if (!ctx || !roles.includes(ctx.user.role)) throw new NotFoundException('Not found.');
    return true;
  }
}

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector, private features: FeaturesService) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const keys = this.reflector.getAllAndMerge<FeatureKey[]>(FEATURES, [ec.getHandler(), ec.getClass()]);
    if (!keys?.length) return true;
    const req = ec.switchToHttp().getRequest();
    const ctx: RequestContext | undefined = req.ctx;
    if (!ctx) return true; // public route
    if (ctx.user.role === Role.ADMIN) return true; // the preview shows an admin what the client sees, but the API never blocks staff
    if (!ctx.clientId) return true; // the route itself answers CLIENT_REQUIRED

    req.features ??= await this.features.forClient(ctx.clientId); // loaded once per request
    for (const key of keys) {
      if (!req.features[key]) {
        throw new ForbiddenException({ statusCode: 403, code: 'FEATURE_DISABLED', feature: key, message: 'This is not switched on for your account. Ask your account manager if you need it.' });
      }
    }
    return true;
  }
}
