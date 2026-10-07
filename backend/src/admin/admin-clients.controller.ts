import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { InvitesService } from '../auth/invites.service';
import { TeamService, userView } from '../auth/team.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../tenancy/audit.service';
import { Ctx, RequestContext } from '../tenancy/ctx';
import { ACTION_KEYS, FEATURE_DEFAULTS, FEATURE_KEYS, SECTION_KEYS, isFeatureKey } from '../tenancy/features.constants';
import { FeaturesService } from '../tenancy/features.service';
import { Roles } from '../tenancy/guards';

type ClientRow = Prisma.ClientGetPayload<object>;

/**
 * Staff only (everyone else is told these routes do not exist). Create and look after client workspaces: who is in them,
 * what is switched on, whether they are paused, which channels are connected. Every change is written to the audit log.
 */
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminClientsController {
  constructor(
    private prisma: PrismaService,
    private invites: InvitesService,
    private team: TeamService,
    private features: FeaturesService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private async client(id: string): Promise<ClientRow> {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found.');
    return client;
  }

  /** The client rows with the numbers an admin wants at a glance. */
  private async withUsage(clients: ClientRow[]) {
    const ids = clients.map((c) => c.id);
    const [people, staff, accounts] = await Promise.all([
      this.prisma.user.groupBy({ by: ['clientId', 'status'], where: { clientId: { in: ids }, role: { not: Role.ADMIN } }, _count: { _all: true } }),
      this.prisma.user.findMany({ where: { clientId: { in: ids }, role: Role.ADMIN }, select: { clientId: true } }),
      this.prisma.socialAccount.findMany({ where: { clientId: { in: ids } }, select: { id: true, clientId: true, provider: true, name: true, disconnectedAt: true } }),
    ]);
    const accountIds = accounts.map((a) => a.id);
    const [counts, last] = await Promise.all([
      this.prisma.scheduledPost.groupBy({ by: ['accountId', 'status'], where: { accountId: { in: accountIds }, status: { in: ['SCHEDULED', 'FAILED'] } }, _count: { _all: true } }),
      this.prisma.scheduledPost.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _max: { updatedAt: true } }),
    ]);
    const clientOf = new Map(accounts.map((a) => [a.id, a.clientId]));

    return clients.map((c) => {
      const mine = accounts.filter((a) => a.clientId === c.id);
      const sum = (status: string) => counts.filter((n) => clientOf.get(n.accountId) === c.id && n.status === status).reduce((t, n) => t + n._count._all, 0);
      const stamps = last.filter((l) => clientOf.get(l.accountId) === c.id).map((l) => l._max.updatedAt?.getTime() ?? 0);
      const seat = (s: string) => people.filter((p) => p.clientId === c.id && p.status === s).reduce((t, p) => t + p._count._all, 0);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        archived: !!c.archivedAt,
        staffWorkspace: staff.some((s) => s.clientId === c.id), // somebody's own workspace, not a managed client
        seatLimit: c.seatLimit,
        seatsUsed: seat('ACTIVE') + seat('INVITED'),
        pendingInvites: seat('INVITED'),
        requireApproval: c.requireApproval,
        notes: c.notes,
        createdAt: c.createdAt,
        channels: mine.filter((a) => !a.disconnectedAt).map((a) => ({ id: a.id, provider: a.provider, name: a.name })),
        disconnectedChannels: mine.filter((a) => a.disconnectedAt).length,
        scheduledPosts: sum('SCHEDULED'),
        failedPosts: sum('FAILED'),
        lastActivityAt: stamps.length && Math.max(...stamps) ? new Date(Math.max(...stamps)) : null,
      };
    });
  }

  private async one(id: string) {
    return (await this.withUsage([await this.client(id)]))[0];
  }

  // ---------------------------------------------------------------- overview

  /** The cross-client picture: what needs a person's attention today. */
  @Get('overview')
  async overview() {
    const clients = await this.prisma.client.findMany({ where: { archivedAt: null } });
    const rows = (await this.withUsage(clients)).filter((c) => !c.staffWorkspace);
    const soon = new Date(Date.now() + 24 * 3_600_000);
    const dueSoon = await this.prisma.scheduledPost.count({ where: { status: 'SCHEDULED', scheduledAt: { lte: soon }, account: { client: { archivedAt: null } } } });
    const attention = rows
      .map((c) => ({
        clientId: c.id,
        name: c.name,
        reasons: [
          c.failedPosts ? `${c.failedPosts} failed post${c.failedPosts === 1 ? '' : 's'}` : '',
          c.disconnectedChannels ? `${c.disconnectedChannels} disconnected channel${c.disconnectedChannels === 1 ? '' : 's'}` : '',
          c.pendingInvites ? `${c.pendingInvites} invitation${c.pendingInvites === 1 ? '' : 's'} not accepted` : '',
          c.status === 'SUSPENDED' ? 'paused' : '',
          !c.channels.length ? 'no channel connected' : '',
        ].filter(Boolean),
      }))
      .filter((c) => c.reasons.length);
    return {
      clients: { active: rows.filter((c) => c.status === 'ACTIVE').length, suspended: rows.filter((c) => c.status === 'SUSPENDED').length },
      channels: { connected: rows.reduce((t, c) => t + c.channels.length, 0), disconnected: rows.reduce((t, c) => t + c.disconnectedChannels, 0) },
      posts: { scheduled: rows.reduce((t, c) => t + c.scheduledPosts, 0), failed: rows.reduce((t, c) => t + c.failedPosts, 0), dueWithin24h: dueSoon },
      pendingInvites: rows.reduce((t, c) => t + c.pendingInvites, 0),
      attention,
    };
  }

  // ---------------------------------------------------------------- clients

  @Get('clients')
  async list(@Query('status') status?: string, @Query('q') q?: string) {
    const where: Prisma.ClientWhereInput = status === 'archived' ? { archivedAt: { not: null } } : { archivedAt: null };
    if (status === 'active') where.status = 'ACTIVE';
    if (status === 'suspended') where.status = 'SUSPENDED';
    if (q?.trim()) where.name = { contains: q.trim().slice(0, 80), mode: 'insensitive' };
    return this.withUsage(await this.prisma.client.findMany({ where, orderBy: { name: 'asc' }, take: 500 }));
  }

  /** A new client and an invitation for its main contact. The link is returned to copy and send; nothing is emailed. */
  @Post('clients')
  async create(@Ctx() ctx: RequestContext, @Body() body: { name?: string; pocEmail?: string }) {
    const name = body.name?.trim();
    if (!name || name.length < 2 || name.length > 80) throw new BadRequestException('Give the client a name of 2 to 80 characters.');
    const client = await this.prisma.client.create({ data: { name, createdById: ctx.user.id } });
    let invite;
    try {
      invite = await this.invites.invite({ clientId: client.id, email: body.pocEmail || '', role: Role.CLIENT_POC, invitedById: ctx.user.id });
    } catch (e) {
      await this.prisma.client.delete({ where: { id: client.id } }); // do not leave a half-made client behind
      throw e;
    }
    await this.audit.record(ctx.user.id, 'client.create', { clientId: client.id, targetType: 'client', targetId: client.id, meta: { name } });
    await this.audit.record(ctx.user.id, 'user.invite', { clientId: client.id, targetType: 'user', targetId: invite.user.id, meta: { email: invite.user.email, role: 'CLIENT_POC' } });
    return { client: await this.one(client.id), invite: { email: invite.user.email, url: invite.url, expiresAt: invite.expiresAt } };
  }

  @Get('clients/:id')
  async get(@Param('id') id: string) {
    const [client, features] = await Promise.all([this.one(id), this.features.forClient(id)]);
    return { ...client, features };
  }

  @Patch('clients/:id')
  async update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { name?: string; notes?: string | null; requireApproval?: boolean }) {
    await this.client(id);
    const data: Prisma.ClientUpdateInput = {};
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 80) throw new BadRequestException('Give the client a name of 2 to 80 characters.');
      data.name = name;
    }
    if (body.notes !== undefined) data.notes = body.notes?.trim().slice(0, 2000) || null;
    if (body.requireApproval !== undefined) data.requireApproval = Boolean(body.requireApproval);
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change.');
    await this.prisma.client.update({ where: { id }, data });
    await this.audit.record(ctx.user.id, 'client.update', { clientId: id, targetType: 'client', targetId: id, meta: data as Prisma.InputJsonObject });
    return this.one(id);
  }

  /** Pauses a client: its people are signed out at once, nothing publishes and automations stop. Analytics keep syncing. */
  @Post('clients/:id/suspend')
  @HttpCode(200)
  async suspend(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.client(id);
    await this.prisma.client.update({ where: { id }, data: { status: 'SUSPENDED' } });
    await this.audit.record(ctx.user.id, 'client.suspend', { clientId: id, targetType: 'client', targetId: id });
    return this.one(id);
  }

  @Post('clients/:id/activate')
  @HttpCode(200)
  async activate(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const client = await this.client(id);
    if (client.archivedAt) throw new BadRequestException('Restore this client from the archive first.');
    await this.prisma.client.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.record(ctx.user.id, 'client.activate', { clientId: id, targetType: 'client', targetId: id });
    return this.one(id);
  }

  /** Takes a client out of the lists and pauses it. Nothing is deleted. Staff workspaces cannot be archived. */
  @Post('clients/:id/archive')
  @HttpCode(200)
  async archive(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.client(id);
    if (await this.prisma.user.count({ where: { clientId: id, role: Role.ADMIN } })) throw new BadRequestException('This is a staff workspace and cannot be archived.');
    await this.prisma.client.update({ where: { id }, data: { archivedAt: new Date(), status: 'SUSPENDED' } });
    await this.audit.record(ctx.user.id, 'client.archive', { clientId: id, targetType: 'client', targetId: id });
    return this.one(id);
  }

  @Post('clients/:id/unarchive')
  @HttpCode(200)
  async unarchive(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.client(id);
    await this.prisma.client.update({ where: { id }, data: { archivedAt: null } }); // stays paused until someone activates it
    await this.audit.record(ctx.user.id, 'client.unarchive', { clientId: id, targetType: 'client', targetId: id });
    return this.one(id);
  }

  @Patch('clients/:id/seats')
  async seats(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { seatLimit?: number }) {
    await this.client(id);
    const limit = body.seatLimit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1000) throw new BadRequestException('Seats must be a whole number from 1 to 1000.');
    const used = await this.invites.seatsUsed(id);
    if ((limit as number) < used) throw new BadRequestException({ statusCode: 400, code: 'SEAT_LIMIT', message: `${used} seats are in use. Remove people before lowering the limit below that.` });
    await this.prisma.client.update({ where: { id }, data: { seatLimit: limit } });
    await this.audit.record(ctx.user.id, 'client.seats', { clientId: id, targetType: 'client', targetId: id, meta: { seatLimit: limit as number } });
    return this.one(id);
  }

  // ---------------------------------------------------------------- switches

  @Get('clients/:id/features')
  async getFeatures(@Param('id') id: string) {
    await this.client(id);
    return { features: await this.features.forClient(id), defaults: FEATURE_DEFAULTS, groups: { sections: SECTION_KEYS, actions: ACTION_KEYS } };
  }

  /** Changes any number of switches at once: `{ "planner": false, "ai": true }`. Only real changes are logged. */
  @Put('clients/:id/features')
  async setFeatures(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.client(id);
    const entries = Object.entries(body || {});
    if (!entries.length) throw new BadRequestException('Say which switches to change.');
    for (const [key, value] of entries) {
      if (!isFeatureKey(key)) throw new BadRequestException(`Unknown feature: ${key}.`);
      if (typeof value !== 'boolean') throw new BadRequestException(`${key} must be true or false.`);
    }
    const before = await this.features.forClient(id);
    for (const [key, value] of entries as [string, boolean][]) {
      if (before[key as (typeof FEATURE_KEYS)[number]] === value) continue;
      await this.features.set(id, key, value, ctx.user.id);
      await this.audit.record(ctx.user.id, 'feature.set', { clientId: id, targetType: 'feature', targetId: key, meta: { enabled: value } });
    }
    return { features: await this.features.forClient(id), defaults: FEATURE_DEFAULTS, groups: { sections: SECTION_KEYS, actions: ACTION_KEYS } };
  }

  // ---------------------------------------------------------------- people

  @Get('clients/:id/users')
  async users(@Param('id') id: string) {
    await this.client(id);
    return this.team.members(id);
  }

  @Post('clients/:id/invite')
  async invite(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { email?: string; role?: string }) {
    await this.client(id);
    const role = body.role === 'CLIENT_POC' ? Role.CLIENT_POC : Role.CLIENT_MEMBER;
    const invite = await this.team.invite(id, body.email || '', role, ctx.user.id);
    await this.audit.record(ctx.user.id, 'user.invite', { clientId: id, targetType: 'user', targetId: invite.user.id, meta: { email: invite.user.email, role } });
    return { user: userView(invite.user), invite: { email: invite.user.email, url: invite.url, expiresAt: invite.expiresAt } };
  }

  @Post('users/:id/resend-invite')
  @HttpCode(200)
  async resend(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.find(null, id);
    const link = await this.team.resend(user, ctx.user.id);
    await this.audit.record(ctx.user.id, 'user.resend_invite', { clientId: user.clientId, targetType: 'user', targetId: id });
    return { invite: { email: user.email, url: link.url, expiresAt: link.expiresAt } };
  }

  /** A one-time link for someone who has forgotten their password. Staff send it; nothing is emailed. */
  @Post('users/:id/reset-link')
  @HttpCode(200)
  async resetLink(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.find(null, id);
    const link = await this.team.resetLink(user, ctx.user.id);
    await this.audit.record(ctx.user.id, 'user.reset_link', { clientId: user.clientId, targetType: 'user', targetId: id });
    return { reset: { email: user.email, url: link.url, expiresAt: link.expiresAt } };
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  async disable(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.disable(await this.team.find(null, id));
    await this.audit.record(ctx.user.id, 'user.disable', { clientId: user.clientId, targetType: 'user', targetId: id });
    return userView(user);
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  async enable(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const user = await this.team.enable(await this.team.find(null, id));
    await this.audit.record(ctx.user.id, 'user.enable', { clientId: user.clientId, targetType: 'user', targetId: id });
    return userView(user);
  }

  // ---------------------------------------------------------------- channels and activity

  /** Every channel the client has had, connected or not. Connecting and disconnecting go through /auth/:provider/start and DELETE /accounts/:id, acting as the client. */
  @Get('clients/:id/channels')
  async channels(@Param('id') id: string) {
    await this.client(id);
    const rows = await this.prisma.socialAccount.findMany({ where: { clientId: id }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => ({
      id: a.id,
      provider: a.provider,
      name: a.name,
      externalId: a.externalId,
      connected: !a.disconnectedAt,
      connectedAt: a.createdAt,
      disconnectedAt: a.disconnectedAt,
      tokenExpires: a.tokenExpires,
      insightsSyncedAt: a.insightsSyncedAt,
      insightsError: a.insightsError,
    }));
  }

  @Get('clients/:id/audit')
  async activity(@Param('id') id: string) {
    await this.client(id);
    return this.audit.forClient(id);
  }
}
