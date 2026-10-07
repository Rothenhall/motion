import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AP_CHANGES, AP_PENDING, BACK_TO_PENDING, PENDING_APPROVAL, publicPost } from './approvals';
import { AuditService } from './tenancy/audit.service';
import { assertInstagramJpeg, mediaUrlList } from './media-rules';
import { Ctx, RequestContext, accountScope, requireClient } from './tenancy/ctx';
import { RequireFeature } from './tenancy/guards';
import { MediaOwnershipService } from './tenancy/media-ownership.service';

const PLATFORMS = ['instagram', 'facebook', 'threads'];
const MEDIA_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
const PROVIDER_FOR: Record<string, string> = { instagram: 'instagram', facebook: 'facebook_page', threads: 'threads' };
const ideaSelect = { id: true, title: true } as const;
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

/** Everything here is limited to the acting client: its channels' posts only. */
@Controller('posts')
export class PostsController {
  constructor(private prisma: PrismaService, private media: MediaOwnershipService, private audit: AuditService) {}

  /** A client user's posts wait for staff when the client requires approval. Staff never wait, in any mode. */
  private async needsApproval(ctx: RequestContext, clientId: string) {
    if (ctx.user.role === Role.ADMIN) return false;
    const client = await this.prisma.client.findUnique({ where: { id: clientId }, select: { requireApproval: true } });
    return !!client?.requireApproval;
  }

  @Get()
  @RequireFeature('planner')
  async list(@Ctx() ctx: RequestContext) {
    const posts = await this.prisma.scheduledPost.findMany({ where: accountScope(ctx), orderBy: { scheduledAt: 'asc' }, include: { account: { select: accountSelect }, idea: { select: ideaSelect } } });
    return posts.map(publicPost);
  }

  @Post()
  @RequireFeature('compose', 'schedule')
  async create(@Ctx() ctx: RequestContext, @Body() body: { accountId?: string; platform?: string; mediaType?: string; caption?: string; mediaUrls?: unknown; scheduledAt?: string; ideaId?: string; draftId?: string }) {
    const accountId = body.accountId?.trim();
    const platform = body.platform?.trim();
    const mediaType = body.mediaType || 'IMAGE';
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!accountId) throw new BadRequestException('Choose an account before scheduling.');
    if (!platform || !PLATFORMS.includes(platform)) throw new BadRequestException('Choose a supported platform.');
    if (!MEDIA_TYPES.includes(mediaType)) throw new BadRequestException('Choose a supported media type.');
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Choose a valid scheduled date.');
    if (scheduledAt.getTime() < Date.now()) throw new BadRequestException('Scheduled time must be in the future.');
    const mediaUrls = mediaUrlList(body.mediaUrls);
    const clientId = requireClient(ctx);
    await this.media.assertUsable(clientId, mediaUrls);
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, clientId, disconnectedAt: null }, select: { id: true, provider: true } });
    if (!account) throw new BadRequestException('That account is no longer connected.');
    if (account.provider !== PROVIDER_FOR[platform]) throw new BadRequestException(`That account can't publish to ${platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Threads'}. Choose a matching account.`);
    if (platform === 'instagram') assertInstagramJpeg(mediaType, mediaUrls);

    const pending = await this.needsApproval(ctx, clientId);

    // Only link an idea that belongs to this client; a stale or foreign id is ignored rather than failing the post.
    const idea = body.ideaId ? await this.prisma.contentIdea.findFirst({ where: { id: body.ideaId, clientId }, select: { id: true } }) : null;

    // The post and its follow-ups succeed or fail together, so a failed cleanup can never report an error for a post that
    // was in fact scheduled (a retry would then schedule it twice). Both ids are scoped to the client.
    const created = await this.prisma.$transaction(async (tx) => {
      const created = await tx.scheduledPost.create({
        data: {
          accountId,
          ideaId: idea?.id ?? null,
          platform,
          mediaType,
          caption: body.caption?.trim() || null,
          mediaUrls: JSON.stringify(mediaUrls),
          scheduledAt,
          // Only these fields are ever read from the body: a client cannot choose its own status or approval state.
          status: pending ? PENDING_APPROVAL : 'SCHEDULED',
          approvalStatus: pending ? AP_PENDING : null,
          createdById: ctx.user.id,
        },
        include: { account: { select: accountSelect }, idea: { select: ideaSelect } },
      });
      // The draft this post was written in is finished.
      if (body.draftId) await tx.postDraft.deleteMany({ where: { id: body.draftId, clientId } });
      // Scheduling an idea means it has been used; leave dismissed ideas alone.
      if (idea) await tx.contentIdea.updateMany({ where: { id: idea.id, clientId, status: { in: ['NEW', 'SAVED'] } }, data: { status: 'USED' } });
      return created;
    });
    if (pending) await this.audit.record(ctx.user.id, 'approval.submit', { clientId, targetType: 'post', targetId: created.id, meta: { postId: created.id, scheduledAt: scheduledAt.toISOString() } });
    return publicPost(created);
  }

  /** Edit a scheduled post in place (time, caption, media). The id stays the same, so insights and links survive. */
  @Patch(':id')
  @RequireFeature('compose')
  async update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { scheduledAt?: string; caption?: string | null; mediaUrls?: unknown }) {
    const post = await this.prisma.scheduledPost.findFirst({ where: { id, ...accountScope(ctx) }, select: { id: true, status: true, platform: true, mediaType: true, approvalStatus: true } });
    if (!post) throw new NotFoundException('Post not found.');
    if (post.status !== 'SCHEDULED' && post.status !== PENDING_APPROVAL) throw new BadRequestException('Only scheduled posts can be edited.');

    // Only these three fields are read from the body; status and approval fields sent by a caller are ignored.
    const data: { scheduledAt?: Date; caption?: string | null; mediaUrls?: string } & Partial<typeof BACK_TO_PENDING> = {};
    if (body.scheduledAt !== undefined) {
      const when = new Date(body.scheduledAt);
      if (Number.isNaN(when.getTime())) throw new BadRequestException('Choose a valid scheduled date.');
      if (when.getTime() < Date.now()) throw new BadRequestException('Scheduled time must be in the future.');
      data.scheduledAt = when;
    }
    if (body.caption !== undefined) data.caption = body.caption?.trim() || null;
    if (body.mediaUrls !== undefined) {
      const mediaUrls = mediaUrlList(body.mediaUrls);
      await this.media.assertUsable(requireClient(ctx), mediaUrls);
      if (post.platform === 'instagram') assertInstagramJpeg(post.mediaType, mediaUrls);
      data.mediaUrls = JSON.stringify(mediaUrls);
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change.');

    // A client's edit sends the post back for review when it has been through review, is waiting for it, or the client requires it.
    // Staff edits leave the approval state alone.
    const clientId = requireClient(ctx);
    const backToReview = ctx.user.role !== Role.ADMIN && (post.status === PENDING_APPROVAL || post.approvalStatus !== null || (await this.needsApproval(ctx, clientId)));
    if (backToReview) Object.assign(data, BACK_TO_PENDING);

    // The scheduler flips SCHEDULED to PUBLISHING and staff decide pending posts; only update while the post is still in the
    // state we read, so an edit can never race a publish or a decision.
    const updated = await this.prisma.scheduledPost.updateMany({ where: { id, status: post.status, approvalStatus: post.approvalStatus }, data });
    if (!updated.count) throw new ConflictException('This post just changed (it started publishing or was reviewed) and can no longer be edited. Reload it.');
    if (backToReview && post.approvalStatus !== AP_PENDING) {
      await this.audit.record(ctx.user.id, post.approvalStatus === null ? 'approval.submit' : 'approval.resubmit', { clientId, targetType: 'post', targetId: id, meta: { postId: id, via: 'edit', from: post.approvalStatus, scheduledAt: (data.scheduledAt ?? null)?.toISOString() ?? null } });
    }
    const out = await this.prisma.scheduledPost.findFirst({ where: { id }, include: { account: { select: accountSelect }, idea: { select: ideaSelect } } });
    return out && publicPost(out);
  }

  /** The client has made the changes staff asked for: send the post back to the review queue. */
  @Post(':id/resubmit')
  @HttpCode(200)
  @RequireFeature('compose', 'schedule')
  async resubmit(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const clientId = requireClient(ctx);
    const post = await this.prisma.scheduledPost.findFirst({ where: { id, ...accountScope(ctx) }, select: { id: true, status: true, approvalStatus: true } });
    if (!post) throw new NotFoundException('Post not found.');
    if (post.status !== PENDING_APPROVAL || post.approvalStatus !== AP_CHANGES) {
      throw new BadRequestException({ statusCode: 400, code: 'NOT_CHANGES_REQUESTED', message: 'Only a post that staff asked you to change can be resubmitted.' });
    }
    const moved = await this.prisma.scheduledPost.updateMany({ where: { id, status: PENDING_APPROVAL, approvalStatus: AP_CHANGES }, data: BACK_TO_PENDING });
    if (!moved.count) throw new ConflictException('This post was just changed. Reload it.');
    await this.audit.record(ctx.user.id, 'approval.resubmit', { clientId, targetType: 'post', targetId: id, meta: { postId: id } });
    return publicPost(await this.prisma.scheduledPost.findUniqueOrThrow({ where: { id }, include: { account: { select: accountSelect }, idea: { select: ideaSelect } } }));
  }

  @Delete(':id')
  @RequireFeature('delete-posts')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const post = await this.prisma.scheduledPost.findFirst({ where: { id, ...accountScope(ctx) }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found.');
    return this.prisma.scheduledPost.delete({ where: { id } });
  }
}
