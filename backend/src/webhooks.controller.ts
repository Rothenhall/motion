import { Controller, Get, Headers, Post, Query, RawBodyRequest, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AutomationsService } from './automations.service';
import { Public } from './auth/auth.guard';
import { verifyMetaSignature } from './auth/crypto';

/** Facebook Page webhooks are signed with the Meta app secret; Instagram Business Login ones with the IG app secret. */
function webhookSecrets() {
  return [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET].filter((s): s is string => !!s);
}

@Public()
@Controller('webhooks/meta')
export class WebhooksController {
  constructor(private auto: AutomationsService) {}

  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: any) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode === 'subscribe' && expected && token === expected) return res.status(200).send(challenge);
    return res.status(403).send('verification failed');
  }

  @Post()
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    if (!verifyMetaSignature(req.rawBody, signature, webhookSecrets())) {
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    const body: any = req.body;
    // object: page | instagram
    for (const entry of body?.entry || []) {
      const channelId = String(entry?.id || '');
      // Page feed comments
      for (const change of entry?.changes || []) {
        const v = change?.value || {};
        if (change?.field === 'feed' && (v.item === 'comment' || v.comment_id)) {
          await this.auto.handleComment({ platform: 'facebook', channelId, commentId: v.comment_id, mediaId: v.post_id, senderId: String(v.from?.id || ''), text: v.message });
        }
        if (change?.field === 'comments' && v.id) {
          await this.auto.handleComment({ platform: 'instagram', channelId, commentId: v.id, mediaId: v.media?.id, senderId: String(v.from?.id || v.from?.username || ''), text: v.text });
        }
      }
      // IG messaging standby etc. ignored for MVP
    }
    return { received: true };
  }
}
