import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const PLATFORMS = ['instagram', 'facebook', 'threads'];
const MEDIA_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

@Controller('posts')
export class PostsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.scheduledPost.findMany({ orderBy: { scheduledAt: 'asc' }, include: { account: { select: accountSelect } } });
  }

  @Post()
  async create(@Body() body: { accountId?: string; platform?: string; mediaType?: string; caption?: string; mediaUrls?: unknown; scheduledAt?: string }) {
    const accountId = body.accountId?.trim();
    const platform = body.platform?.trim();
    const mediaType = body.mediaType || 'IMAGE';
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!accountId) throw new BadRequestException('Choose an account before scheduling.');
    if (!platform || !PLATFORMS.includes(platform)) throw new BadRequestException('Choose a supported platform.');
    if (!MEDIA_TYPES.includes(mediaType)) throw new BadRequestException('Choose a supported media type.');
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) throw new BadRequestException('Choose a valid scheduled date.');
    if (scheduledAt.getTime() < Date.now()) throw new BadRequestException('Scheduled time must be in the future.');
    if (!Array.isArray(body.mediaUrls) || body.mediaUrls.some((url) => typeof url !== 'string')) throw new BadRequestException('Media URLs must be a list of strings.');
    const account = await this.prisma.socialAccount.findUnique({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new BadRequestException('That account is no longer connected.');

    return this.prisma.scheduledPost.create({
      data: {
        accountId,
        platform,
        mediaType,
        caption: body.caption?.trim() || null,
        mediaUrls: JSON.stringify(body.mediaUrls),
        scheduledAt,
        status: 'SCHEDULED',
      },
      include: { account: { select: accountSelect } },
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.scheduledPost.delete({ where: { id } });
  }
}
