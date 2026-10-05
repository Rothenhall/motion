import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PublishersService } from './publishers.service';
import { decryptToken } from './auth/crypto';
import { PRIVATE_REPLY_WINDOW_MS } from './meta-config';

const PROVIDER_FOR: Record<string, string> = { instagram: 'instagram', facebook: 'facebook_page' };

export interface IncomingComment {
  platform: string;
  channelId: string;
  commentId: string;
  mediaId?: string;
  senderId?: string;
  senderUsername?: string;
  text?: string;
  /** When the comment was written, if the webhook says. */
  createdAt?: Date;
}

@Injectable()
export class AutomationsService {
  private readonly log = new Logger(AutomationsService.name);
  private pending = new Set<Promise<void>>();

  constructor(private prisma: PrismaService, private pub: PublishersService) {}

  /**
   * Runs automations after the webhook has been answered: Meta wants a 200
   * within a few seconds and redelivers otherwise.
   */
  enqueue(comments: IncomingComment[]) {
    if (!comments.length) return;
    const job = (async () => {
      for (const c of comments) {
        try {
          await this.handleComment(c);
        } catch (e) {
          this.log.error(`Automation failed for comment ${c.commentId}: ${String((e as any)?.message || e)}`);
        }
      }
    })();
    this.pending.add(job);
    job.finally(() => this.pending.delete(job));
  }

  /** Resolves once queued webhook work is done. Used by tests and shutdown. */
  async idle() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /**
   * `channelId` is the webhook entry id (Page ID / IG user ID). Only the
   * accounts connected for that channel record the comment and run their rules,
   * so one workspace's comments never trigger another workspace's automations.
   *
   * Each comment is handled at most once: the CommentEvent row is the claim, so a
   * redelivered webhook, or the webhook for a reply Motion itself posted, is skipped.
   * The first active rule that matches wins, since Meta allows only one private
   * reply per comment.
   */
  async handleComment(opts: IncomingComment) {
    const provider = PROVIDER_FOR[opts.platform];
    if (!provider || !opts.channelId || !opts.commentId) return;
    const accounts = await this.prisma.socialAccount.findMany({
      where: { provider, externalId: opts.channelId },
      include: { rules: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    });

    for (const account of accounts) {
      if (this.isOwnComment(account, opts)) continue;

      const claimed = await this.claim(account.id, opts);
      if (!claimed) continue;
      const key = { accountId_commentId: { accountId: account.id, commentId: opts.commentId } };

      const rule = account.rules.find((r) => {
        if (r.trigger === 'COMMENT_KEYWORD') return !!r.keyword && (opts.text || '').toLowerCase().includes(r.keyword.toLowerCase());
        return r.trigger === 'ALL_COMMENTS';
      });
      if (!rule) continue;

      const token = decryptToken(account.accessToken);
      try {
        let acted = false;
        if ((rule.replyMode === 'PUBLIC' || rule.replyMode === 'PUBLIC_AND_DM') && rule.publicReply) {
          const replyId =
            opts.platform === 'instagram'
              ? await this.pub.replyInstagramComment(opts.commentId, rule.publicReply, token)
              : await this.pub.replyFacebookComment(opts.commentId, rule.publicReply, token);
          acted = true;
          // Mark our own reply as handled so its webhook doesn't trigger this rule again.
          if (replyId) await this.claim(account.id, { ...opts, commentId: String(replyId), senderId: account.externalId, text: rule.publicReply }, true);
        }
        if ((rule.replyMode === 'DM' || rule.replyMode === 'PUBLIC_AND_DM') && rule.dmText) {
          if (opts.createdAt && Date.now() - opts.createdAt.getTime() > PRIVATE_REPLY_WINDOW_MS) {
            this.log.warn(`Skipped DM for comment ${opts.commentId}: older than 7 days.`);
          } else {
            if (opts.platform === 'instagram') await this.pub.privateReplyInstagram(account.externalId, opts.commentId, rule.dmText, token);
            else await this.pub.privateReplyFacebook(account.externalId, opts.commentId, rule.dmText, token);
            await this.prisma.commentEvent.update({ where: key, data: { dmSent: true } });
            acted = true;
          }
        }
        if (acted) await this.prisma.commentEvent.update({ where: key, data: { replied: true } });
      } catch (e: any) {
        const detail = e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message || e);
        this.log.error(`Automation ${rule.id} failed on comment ${opts.commentId}: ${detail}`);
      }
    }
  }

  /** Comments the account wrote itself (including Motion's own replies) never trigger rules. */
  private isOwnComment(account: { externalId: string; meta: string | null }, opts: IncomingComment) {
    if (opts.senderId && opts.senderId === account.externalId) return true;
    if (!opts.senderUsername) return false;
    try {
      const username = JSON.parse(account.meta || '{}').username;
      return !!username && String(username).toLowerCase() === opts.senderUsername.toLowerCase();
    } catch {
      return false;
    }
  }

  /** Records the comment; false when it was already recorded (a redelivery, or a reply Motion posted). */
  private async claim(accountId: string, opts: IncomingComment, replied = false) {
    try {
      await this.prisma.commentEvent.create({
        data: { accountId, platform: opts.platform, commentId: opts.commentId, mediaId: opts.mediaId, senderId: opts.senderId, text: opts.text, replied },
      });
      return true;
    } catch (e: any) {
      if (e?.code === 'P2002') return false;
      throw e;
    }
  }
}
