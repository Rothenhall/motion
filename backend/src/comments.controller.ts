import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';

@Controller('comments')
export class CommentsController {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  @Get('events')
  events() { return this.prisma.commentEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }

  @Post('reply')
  async reply(@Body() body: { platform?: string; commentId?: string; text?: string; accountId?: string; dm?: boolean }) {
    const platform = body.platform?.trim();
    const commentId = body.commentId?.trim();
    const text = body.text?.trim();
    if (!platform || !['instagram', 'facebook'].includes(platform)) throw new BadRequestException('Choose Instagram or Facebook.');
    if (!commentId || !text) throw new BadRequestException('A comment ID and message are required.');

    const account = body.accountId
      ? await this.prisma.socialAccount.findUnique({ where: { id: body.accountId } })
      : await this.prisma.socialAccount.findFirst({ where: { provider: platform === 'instagram' ? 'instagram' : 'facebook_page' }, orderBy: { createdAt: 'asc' } });
    if (!account) throw new BadRequestException('Connect a matching account before replying.');
    if (platform === 'instagram' && account.provider !== 'instagram') throw new BadRequestException('Select an Instagram account for this reply.');
    if (platform === 'facebook' && account.provider !== 'facebook_page') throw new BadRequestException('Select a Facebook Page account for this reply.');

    if (platform === 'instagram') {
      if (body.dm) return this.pub.privateReplyInstagram(account.externalId, commentId, text, account.accessToken);
      return this.pub.replyInstagramComment(commentId, text, account.accessToken);
    }
    return this.pub.replyFacebookComment(commentId, text, account.accessToken);
  }
}
