import { BadRequestException, ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Who is calling and which client's data the call is about. Built once per request by AuthGuard.
 *
 * `clientId` is the *effective* client: a client user's own, or for an admin the one named in the X-Client-Id header
 * (acting as that client) and otherwise their home workspace. Controllers must take it from here and never from the
 * request body or URL.
 */
export interface RequestContext {
  user: { id: string; email: string; role: Role };
  clientId: string | null;
  /** An admin acting on a client other than their own workspace. */
  acting: boolean;
  /** Acting in "view as client" mode: the server refuses writes. */
  readOnlyPreview: boolean;
}

/** The request context, as attached by AuthGuard. */
export const Ctx = createParamDecorator((_data: unknown, ec: ExecutionContext): RequestContext => ec.switchToHttp().getRequest().ctx);

/** The client every tenant query must be limited to. Throws if there is none, so a query can never run unscoped. */
export function requireClient(ctx: RequestContext): string {
  if (!ctx.clientId) throw new BadRequestException({ statusCode: 400, code: 'CLIENT_REQUIRED', message: 'Choose a client first.' });
  return ctx.clientId;
}

/** `where` fragment for models that carry their own clientId (drafts, ideas, hooks, checks, brand profile, accounts). */
export const clientScope = (ctx: RequestContext) => ({ clientId: requireClient(ctx) });

/** `where` fragment for models that belong to a client through their channel (posts, rules, comments, insights). */
export const accountScope = (ctx: RequestContext) => ({ account: { clientId: requireClient(ctx) } });
