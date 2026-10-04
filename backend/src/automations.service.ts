import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';
import { decryptToken } from './auth/crypto';

const PROVIDER_FOR: Record<string, string> = { instagram: 'instagram', facebook: 'facebook_page' };

@Injectable()
export class AutomationsService {
  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  /**
   * `channelId` is the webhook entry id (Page ID / IG user ID). Only the
   * accounts connected for that channel record the comment and run their rules,
   * so one workspace's comments never trigger another workspace's automations.
   */
  async handleComment(opts: { platform: string; channelId: string; commentId: string; mediaId?: string; senderId?: string; text?: string }) {
    const provider = PROVIDER_FOR[opts.platform];
    if (!provider || !opts.channelId || !opts.commentId) return;
    const accounts = await this.prisma.socialAccount.findMany({
      where: { provider, externalId: opts.channelId },
      include: { rules: { where: { isActive: true } } },
    });

    for (const account of accounts) {
      const key = { accountId_commentId: { accountId: account.id, commentId: opts.commentId } };
      await this.prisma.commentEvent.upsert({
        where: key,
        create: { accountId: account.id, platform: opts.platform, commentId: opts.commentId, mediaId: opts.mediaId, senderId: opts.senderId, text: opts.text },
        update: {},
      });
      const token = decryptToken(account.accessToken);

      for (const r of account.rules) {
        if (r.trigger === 'COMMENT_KEYWORD' && r.keyword) {
          if (!(opts.text || '').toLowerCase().includes(r.keyword.toLowerCase())) continue;
        }
        try {
          if (r.replyMode === 'PUBLIC' || r.replyMode === 'PUBLIC_AND_DM') {
            if (r.publicReply) {
              if (opts.platform === 'instagram') await this.pub.replyInstagramComment(opts.commentId, r.publicReply, token);
              else await this.pub.replyFacebookComment(opts.commentId, r.publicReply, token);
            }
          }
          if ((r.replyMode === 'DM' || r.replyMode === 'PUBLIC_AND_DM') && r.dmText && opts.platform === 'instagram') {
            await this.pub.privateReplyInstagram(account.externalId, opts.commentId, r.dmText, token);
            await this.prisma.commentEvent.update({ where: key, data: { dmSent: true } });
          }
          await this.prisma.commentEvent.update({ where: key, data: { replied: true } });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('automation failed', r.id, e);
        }
      }
    }
  }
}
