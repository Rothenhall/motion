import { Controller, Get, Headers, HttpCode, Post, Query, RawBodyRequest, Req, Res, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { AutomationsService, IncomingComment } from './automations.service';
import { Public } from './auth/auth.guard';
import { verifyMetaSignature } from './auth/crypto';

/**
 * Facebook Page webhooks are signed with the Meta app secret, Instagram Business
 * Login ones with the IG app secret, and Threads ones with the Threads app secret.
 */
function webhookSecrets() {
  return [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET, process.env.META_THREADS_APP_SECRET].filter((s): s is string => !!s);
}

/** Webhook timestamps are Unix seconds; tolerate milliseconds too. */
function toDate(t: unknown): Date | undefined {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n > 1e12 ? n : n * 1000);
}

/** Pulls new comments out of a Page (`feed`) or Instagram (`comments`) webhook body. */
export function commentsFromWebhook(body: any): IncomingComment[] {
  const out: IncomingComment[] = [];
  for (const entry of body?.entry || []) {
    const channelId = String(entry?.id || '');
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      // Page feed: only newly added comments. Edits and removals arrive with
      // verb "edited" / "remove" and must not trigger replies again.
      if (body?.object === 'page' && change?.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.comment_id) {
        out.push({
          platform: 'facebook',
          channelId,
          commentId: String(v.comment_id),
          mediaId: v.post_id,
          senderId: v.from?.id ? String(v.from.id) : undefined,
          text: v.message,
          createdAt: toDate(v.created_time),
        });
      }
      if (body?.object === 'instagram' && change?.field === 'comments' && v.id) {
        out.push({
          platform: 'instagram',
          channelId,
          commentId: String(v.id),
          mediaId: v.media?.id,
          senderId: v.from?.id ? String(v.from.id) : undefined,
          senderUsername: v.from?.username,
          text: v.text,
          createdAt: toDate(entry?.time),
        });
      }
    }
    // Messaging events (DM follow-ups) are not handled yet.
  }
  return out;
}

@Public()
@SkipThrottle() // Meta retries and bursts; its calls are verified by signature instead
@Controller('webhooks/meta')
export class WebhooksController {
  constructor(private auto: AutomationsService) {}

  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: any) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) return res.status(200).send(challenge);
    return res.status(403).send('verification failed');
  }

  /** Answers 200 straight away (Meta redelivers after 5s) and runs automations afterwards. */
  @Post()
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    if (!verifyMetaSignature(req.rawBody, signature, webhookSecrets())) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    this.auto.enqueue(commentsFromWebhook(req.body));
    return { received: true };
  }
}
