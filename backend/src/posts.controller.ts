import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuthUser, CurrentUser } from './auth/auth.guard';
import { NON_JPEG_IMAGE, VIDEO_URL } from './meta-config';

const PLATFORMS = ['instagram', 'facebook', 'threads'];
const MEDIA_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'REELS', 'STORIES', 'CAROUSEL'];
const PROVIDER_FOR: Record<string, string> = { instagram: 'instagram', facebook: 'facebook_page', threads: 'threads' };
const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

@Controller('posts')
export class PostsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.scheduledPost.findMany({ where: { account: { userId: user.id } }, orderBy: { scheduledAt: 'asc' }, include: { account: { select: accountSelect } } });
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: { accountId?: string; platform?: string; mediaType?: string; caption?: string; mediaUrls?: unknown; scheduledAt?: string }) {
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
    const account = await this.prisma.socialAccount.findFirst({ where: { id: accountId, userId: user.id }, select: { id: true, provider: true } });
    if (!account) throw new BadRequestException('That account is no longer connected.');
    if (account.provider !== PROVIDER_FOR[platform]) throw new BadRequestException(`That account can't publish to ${platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'Threads'}. Choose a matching account.`);
    if (platform === 'instagram' && mediaType !== 'VIDEO' && mediaType !== 'REELS' && (body.mediaUrls as string[]).some((u) => NON_JPEG_IMAGE.test(u) && !VIDEO_URL.test(u))) {
      throw new BadRequestException('Instagram only publishes JPEG images. Upload a JPG instead of PNG, WebP or GIF.');
    }

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
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const post = await this.prisma.scheduledPost.findFirst({ where: { id, account: { userId: user.id } }, select: { id: true } });
    if (!post) throw new NotFoundException('Post not found.');
    return this.prisma.scheduledPost.delete({ where: { id } });
  }
}
