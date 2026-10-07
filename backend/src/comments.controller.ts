import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';
import { decryptToken } from './auth/crypto';
import { Ctx, RequestContext, accountScope, clientScope } from './tenancy/ctx';
import { RequireFeature } from './tenancy/guards';

@Controller('comments')
@RequireFeature('inbox')
export class CommentsController {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  /** Recent comments, each with the post it was left on when we published that post ourselves. */
  @Get('events')
  async events(@Ctx() ctx: RequestContext) {
    const events = await this.prisma.commentEvent.findMany({ where: accountScope(ctx), orderBy: { createdAt: 'desc' }, take: 100 });
    const mediaIds = [...new Set(events.map((e) => e.mediaId).filter((m): m is string => !!m))];
    if (!mediaIds.length) return events.map((e) => ({ ...e, post: null }));

    // Facebook reports "pageId_postId" while we may have stored either form, so match on the id's last segment too.
    const tail = (id: string) => id.split('_').pop() as string;
    const tails = [...new Set(mediaIds.map(tail))];
    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        ...accountScope(ctx),
        status: 'PUBLISHED',
        OR: tails.flatMap((t) => [{ externalId: t }, { externalId: { endsWith: `_${t}` } }]),
      },
      select: { id: true, accountId: true, externalId: true, caption: true, mediaType: true, mediaUrls: true, permalink: true, scheduledAt: true },
    });
    const byKey = new Map<string, (typeof posts)[number]>();
    for (const post of posts) if (post.externalId) byKey.set(`${post.accountId}:${tail(post.externalId)}`, post);
    return events.map((e) => {
      const post = e.mediaId && e.accountId ? byKey.get(`${e.accountId}:${tail(e.mediaId)}`) : undefined;
      return { ...e, post: post ? { id: post.id, caption: post.caption, mediaType: post.mediaType, mediaUrls: post.mediaUrls, permalink: post.permalink, publishedAt: post.scheduledAt } : null };
    });
  }

  @Post('reply')
  @RequireFeature('inbox-reply')
  async reply(@Ctx() ctx: RequestContext, @Body() body: { platform?: string; commentId?: string; text?: string; accountId?: string; dm?: boolean }) {
    const platform = body.platform?.trim();
    const commentId = body.commentId?.trim();
    const text = body.text?.trim();
    if (!platform || !['instagram', 'facebook'].includes(platform)) throw new BadRequestException('Choose Instagram or Facebook.');
    if (!commentId || !text) throw new BadRequestException('A comment ID and message are required.');

    const account = body.accountId
      ? await this.prisma.socialAccount.findFirst({ where: { id: body.accountId, ...clientScope(ctx), disconnectedAt: null } })
      : await this.prisma.socialAccount.findFirst({ where: { ...clientScope(ctx), disconnectedAt: null, provider: platform === 'instagram' ? 'instagram' : 'facebook_page' }, orderBy: { createdAt: 'asc' } });
    if (!account) throw new BadRequestException('Connect a matching account before replying.');
    if (platform === 'instagram' && account.provider !== 'instagram') throw new BadRequestException('Select an Instagram account for this reply.');
    if (platform === 'facebook' && account.provider !== 'facebook_page') throw new BadRequestException('Select a Facebook Page account for this reply.');

    const token = decryptToken(account.accessToken);
    let result: unknown;
    if (platform === 'instagram') {
      result = body.dm
        ? await this.pub.privateReplyInstagram(account.externalId, commentId, text, token)
        : await this.pub.replyInstagramComment(commentId, text, token);
    } else {
      result = body.dm
        ? await this.pub.privateReplyFacebook(account.externalId, commentId, text, token)
        : await this.pub.replyFacebookComment(commentId, text, token);
    }
    // Only reached when Meta accepted the reply (a failure throws above), so the comment is now handled.
    await this.prisma.commentEvent.updateMany({
      where: { accountId: account.id, commentId },
      data: body.dm ? { replied: true, dmSent: true } : { replied: true },
    });
    return result;
  }
}
