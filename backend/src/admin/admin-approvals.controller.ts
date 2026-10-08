import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AP_APPROVED, AP_CHANGES, AP_PENDING, PENDING_APPROVAL, approvalItem, itemInclude } from '../approvals';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../tenancy/audit.service';
import { Ctx, RequestContext } from '../tenancy/ctx';
import { Roles } from '../tenancy/guards';

const NOTE_MIN = 3;
const NOTE_MAX = 500;
const QUEUE_LIMIT = 200;

/** Staff only (everyone else is told these routes do not exist). The review queue for posts clients submit for approval. */
@Controller('admin')
@Roles(Role.ADMIN)
export class AdminApprovalsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private async items(rows: Parameters<typeof approvalItem>[0][]) {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((i): i is string => !!i))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return rows.map((r) => approvalItem(r, email));
  }

  private async item(postId: string) {
    const row = await this.prisma.scheduledPost.findUniqueOrThrow({ where: { id: postId }, include: itemInclude });
    return (await this.items([row]))[0];
  }

  /** Everything waiting for a decision, oldest first. Archived clients are left out. */
  @Get('approvals')
  async queue(@Query('clientId') clientId?: string) {
    const where = { approvalStatus: AP_PENDING, account: { client: { archivedAt: null }, ...(clientId ? { clientId: String(clientId) } : {}) } };
    const [rows, total] = await Promise.all([
      this.prisma.scheduledPost.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: QUEUE_LIMIT, include: itemInclude }),
      this.prisma.scheduledPost.count({ where }),
    ]);
    return { items: await this.items(rows), total };
  }

  @Get('approvals/count')
  async count() {
    return { pending: await this.prisma.scheduledPost.count({ where: { approvalStatus: AP_PENDING, account: { client: { archivedAt: null } } } }) };
  }

  @Get('clients/:id/approvals')
  async forClient(@Param('id') id: string) {
    if (!(await this.prisma.client.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Client not found.');
    const [pending, recent] = await Promise.all([
      this.prisma.scheduledPost.findMany({ where: { approvalStatus: AP_PENDING, account: { clientId: id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: QUEUE_LIMIT, include: itemInclude }),
      this.prisma.scheduledPost.findMany({ where: { approvalStatus: { in: [AP_APPROVED, AP_CHANGES] }, approvalDecidedAt: { not: null }, account: { clientId: id } }, orderBy: { approvalDecidedAt: 'desc' }, take: 20, include: itemInclude }),
    ]);
    return { pending: await this.items(pending), recent: await this.items(recent) };
  }

  private async load(postId: string) {
    const post = await this.prisma.scheduledPost.findUnique({ where: { id: postId }, select: { id: true, status: true, approvalStatus: true, scheduledAt: true, account: { select: { clientId: true, disconnectedAt: true } } } });
    if (!post) throw new NotFoundException('Post not found.');
    return post;
  }

  private notPending() {
    return new ConflictException({ statusCode: 409, code: 'NOT_PENDING', message: 'This post has already been decided or is no longer waiting for approval.' });
  }

  /** Approving schedules the post. A post whose time has passed needs a new, future `scheduledAt`. */
  @Post('approvals/:postId/approve')
  @HttpCode(200)
  async approve(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body() body: { scheduledAt?: string } = {}) {
    let newTime: Date | null = null;
    if (body?.scheduledAt !== undefined && body.scheduledAt !== null) {
      newTime = new Date(body.scheduledAt);
      if (typeof body.scheduledAt !== 'string' || Number.isNaN(newTime.getTime())) throw new BadRequestException('Choose a valid scheduled date.');
      if (newTime.getTime() <= Date.now()) throw new BadRequestException({ statusCode: 400, code: 'SCHEDULE_TIME_PASSED', message: 'Choose a time in the future.' });
    }
    const post = await this.load(postId);
    if (post.status !== PENDING_APPROVAL || post.approvalStatus !== AP_PENDING) throw this.notPending();
    if (post.account.disconnectedAt) throw this.disconnected();
    if (!newTime && post.scheduledAt.getTime() <= Date.now()) throw this.passed();

    // One conditional update decides it: two staff approving at once cannot both win, and the channel and time are
    // re-checked in the same statement so a disconnect or the clock cannot slip between the checks above and the write.
    const now = new Date();
    const done = await this.prisma.scheduledPost.updateMany({
      where: { id: postId, status: PENDING_APPROVAL, approvalStatus: AP_PENDING, account: { disconnectedAt: null }, ...(newTime ? {} : { scheduledAt: { gt: now } }) },
      data: { status: 'SCHEDULED', approvalStatus: AP_APPROVED, approvalNote: null, approvalDecidedAt: now, approvalDecidedById: ctx.user.id, ...(newTime ? { scheduledAt: newTime } : {}) },
    });
    if (done.count !== 1) {
      const again = await this.load(postId); // 404 if the client deleted it meanwhile
      if (again.status !== PENDING_APPROVAL || again.approvalStatus !== AP_PENDING) throw this.notPending();
      if (again.account.disconnectedAt) throw this.disconnected();
      throw this.passed();
    }
    await this.audit.record(ctx.user.id, 'approval.approve', {
      clientId: post.account.clientId,
      targetType: 'post',
      targetId: postId,
      meta: { postId, scheduledAt: (newTime ?? post.scheduledAt).toISOString(), rescheduled: !!newTime },
    });
    return this.item(postId);
  }

  /** Sends the post back to the client with a note. It stays out of the scheduler until the client resubmits. */
  @Post('approvals/:postId/request-changes')
  @HttpCode(200)
  async requestChanges(@Ctx() ctx: RequestContext, @Param('postId') postId: string, @Body() body: { note?: string } = {}) {
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length < NOTE_MIN || note.length > NOTE_MAX) throw new BadRequestException(`Write a note of ${NOTE_MIN} to ${NOTE_MAX} characters saying what to change.`);
    const post = await this.load(postId);
    if (post.status !== PENDING_APPROVAL || post.approvalStatus !== AP_PENDING) throw this.notPending();
    const done = await this.prisma.scheduledPost.updateMany({
      where: { id: postId, status: PENDING_APPROVAL, approvalStatus: AP_PENDING },
      data: { approvalStatus: AP_CHANGES, approvalNote: note, approvalDecidedAt: new Date(), approvalDecidedById: ctx.user.id },
    });
    if (done.count !== 1) throw this.notPending();
    await this.audit.record(ctx.user.id, 'approval.request_changes', { clientId: post.account.clientId, targetType: 'post', targetId: postId, meta: { postId, note } });
    return this.item(postId);
  }

  private disconnected() {
    return new BadRequestException({ statusCode: 400, code: 'CHANNEL_DISCONNECTED', message: 'This post\'s channel is disconnected. Reconnect it, or ask the client to choose another channel, before approving.' });
  }

  private passed() {
    return new BadRequestException({ statusCode: 400, code: 'SCHEDULE_TIME_PASSED', message: 'The scheduled time has passed. Choose a new time in the future to approve this post.' });
  }
}
