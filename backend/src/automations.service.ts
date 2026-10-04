import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';

@Injectable()
export class AutomationsService {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  async handleComment(opts: { platform: string; commentId: string; mediaId?: string; senderId?: string; text?: string }) {
    await this.prisma.commentEvent.upsert({
      where: { commentId: opts.commentId },
      create: { platform: opts.platform, commentId: opts.commentId, mediaId: opts.mediaId, senderId: opts.senderId, text: opts.text },
      update: {},
    });
    const rules = await this.prisma.automationRule.findMany({ where: { isActive: true }, include: { account: true } });
    for (const r of rules) {
      const isIgRule = r.account.provider === 'instagram' && opts.platform === 'instagram';
      const isFbRule = r.account.provider === 'facebook_page' && opts.platform === 'facebook';
      if (!isIgRule && !isFbRule) continue;
      if (r.trigger === 'COMMENT_KEYWORD' && r.keyword) {
        if (!(opts.text || '').toLowerCase().includes(r.keyword.toLowerCase())) continue;
      }
      try {
        if (r.replyMode === 'PUBLIC' || r.replyMode === 'PUBLIC_AND_DM') {
          if (r.publicReply) {
            if (opts.platform === 'instagram') await this.pub.replyInstagramComment(opts.commentId, r.publicReply, r.account.accessToken);
            else await this.pub.replyFacebookComment(opts.commentId, r.publicReply, r.account.accessToken);
          }
        }
        if ((r.replyMode === 'DM' || r.replyMode === 'PUBLIC_AND_DM') && r.dmText && opts.platform === 'instagram') {
          await this.pub.privateReplyInstagram(r.account.externalId, opts.commentId, r.dmText, r.account.accessToken);
          await this.prisma.commentEvent.update({ where: { commentId: opts.commentId }, data: { dmSent: true } });
        }
        await this.prisma.commentEvent.update({ where: { commentId: opts.commentId }, data: { replied: true } });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('automation failed', r.id, e);
      }
    }
  }
}
