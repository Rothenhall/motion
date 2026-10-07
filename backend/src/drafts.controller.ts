import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { mediaUrlList } from './media-rules';
import { Ctx, RequestContext, clientScope, requireClient } from './tenancy/ctx';
import { RequireFeature } from './tenancy/guards';
import { MediaOwnershipService } from './tenancy/media-ownership.service';

const PLATFORMS = ['instagram', 'facebook', 'threads'];
const MEDIA_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
const MAX_CAPTION = 63_206;
const MAX_DRAFTS = 100; // per client: drafts autosave, so without a cap a stuck browser could fill the table

type DraftBody = { accountId?: string | null; platform?: string | null; mediaType?: string; caption?: string | null; mediaUrls?: unknown; scheduledAt?: string | null; ideaId?: string | null };

/** Drafts are saved as the user types, so validation is lenient: anything may be missing, but what is there must be sane. */
@Controller('drafts')
@RequireFeature('compose')
export class DraftsController {
  constructor(private prisma: PrismaService, private media: MediaOwnershipService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.prisma.postDraft.findMany({ where: clientScope(ctx), orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  @Post()
  async create(@Ctx() ctx: RequestContext, @Body() body: DraftBody) {
    const clientId = requireClient(ctx);
    if ((await this.prisma.postDraft.count({ where: { clientId } })) >= MAX_DRAFTS) throw new BadRequestException(`You have ${MAX_DRAFTS} drafts. Delete some before saving more.`);
    const data = await this.clean(ctx, body);
    return this.prisma.postDraft.create({ data: { userId: ctx.user.id, clientId, ...data } });
  }

  @Patch(':id')
  async update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: DraftBody) {
    const own = await this.prisma.postDraft.findFirst({ where: { id, ...clientScope(ctx) }, select: { id: true } });
    if (!own) throw new NotFoundException('Draft not found.');
    const data = await this.clean(ctx, body);
    return this.prisma.postDraft.update({ where: { id }, data: { ...data, userId: ctx.user.id } });
  }

  @Delete(':id')
  async remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    const own = await this.prisma.postDraft.findFirst({ where: { id, ...clientScope(ctx) }, select: { id: true } });
    if (!own) throw new NotFoundException('Draft not found.');
    await this.prisma.postDraft.delete({ where: { id } });
    return { ok: true };
  }

  private async clean(ctx: RequestContext, body: DraftBody) {
    const clientId = requireClient(ctx);
    const data: { accountId?: string | null; platform?: string | null; mediaType?: string; caption?: string | null; mediaUrls?: string; scheduledAt?: Date | null; ideaId?: string | null } = {};
    if (body.accountId !== undefined) {
      if (body.accountId) {
        const account = await this.prisma.socialAccount.findFirst({ where: { id: body.accountId, clientId, disconnectedAt: null }, select: { id: true } });
        if (!account) throw new BadRequestException('That account is no longer connected.');
      }
      data.accountId = body.accountId || null;
    }
    if (body.platform !== undefined) {
      if (body.platform && !PLATFORMS.includes(body.platform)) throw new BadRequestException('Choose a supported platform.');
      data.platform = body.platform || null;
    }
    if (body.mediaType !== undefined) {
      if (!MEDIA_TYPES.includes(body.mediaType)) throw new BadRequestException('Choose a supported media type.');
      data.mediaType = body.mediaType;
    }
    if (body.caption !== undefined) {
      if (body.caption && body.caption.length > MAX_CAPTION) throw new BadRequestException('That caption is too long.');
      data.caption = body.caption || null;
    }
    if (body.mediaUrls !== undefined) {
      const urls = mediaUrlList(body.mediaUrls);
      await this.media.assertUsable(clientId, urls);
      data.mediaUrls = JSON.stringify(urls);
    }
    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt) {
        const when = new Date(body.scheduledAt);
        if (Number.isNaN(when.getTime())) throw new BadRequestException('Choose a valid date.');
        data.scheduledAt = when;
      } else data.scheduledAt = null;
    }
    if (body.ideaId !== undefined) {
      const idea = body.ideaId ? await this.prisma.contentIdea.findFirst({ where: { id: body.ideaId, clientId }, select: { id: true } }) : null;
      data.ideaId = idea?.id ?? null;
    }
    return data;
  }
}
