import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';
import { AuthUser, CurrentUser } from './auth/auth.guard';
import { decryptToken } from './auth/crypto';

@Controller('comments')
export class CommentsController {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  @Get('events')
  events(@CurrentUser() user: AuthUser) {
    return this.prisma.commentEvent.findMany({ where: { account: { userId: user.id } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Post('reply')
  async reply(@CurrentUser() user: AuthUser, @Body() body: { platform?: string; commentId?: string; text?: string; accountId?: string; dm?: boolean }) {
    const platform = body.platform?.trim();
    const commentId = body.commentId?.trim();
    const text = body.text?.trim();
    if (!platform || !['instagram', 'facebook'].includes(platform)) throw new BadRequestException('Choose Instagram or Facebook.');
    if (!commentId || !text) throw new BadRequestException('A comment ID and message are required.');

    const account = body.accountId
      ? await this.prisma.socialAccount.findFirst({ where: { id: body.accountId, userId: user.id } })
      : await this.prisma.socialAccount.findFirst({ where: { userId: user.id, provider: platform === 'instagram' ? 'instagram' : 'facebook_page' }, orderBy: { createdAt: 'asc' } });
    if (!account) throw new BadRequestException('Connect a matching account before replying.');
    if (platform === 'instagram' && account.provider !== 'instagram') throw new BadRequestException('Select an Instagram account for this reply.');
    if (platform === 'facebook' && account.provider !== 'facebook_page') throw new BadRequestException('Select a Facebook Page account for this reply.');

    const token = decryptToken(account.accessToken);
    if (platform === 'instagram') {
      if (body.dm) return this.pub.privateReplyInstagram(account.externalId, commentId, text, token);
      return this.pub.replyInstagramComment(commentId, text, token);
    }
    return this.pub.replyFacebookComment(commentId, text, token);
  }
}
