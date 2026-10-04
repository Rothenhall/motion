import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { AutomationsService } from './automations.service';

@Controller('webhooks/meta')
export class WebhooksController {
  constructor(private auto: AutomationsService) {}

  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: any) {
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send('verification failed');
  }

  @Post()
  async receive(@Body() body: any) {
    // object: page | instagram
    for (const entry of body?.entry || []) {
      // Page feed comments
      for (const change of entry?.changes || []) {
        const v = change?.value || {};
        if (change?.field === 'feed' && (v.item === 'comment' || v.comment_id)) {
          await this.auto.handleComment({ platform: 'facebook', commentId: v.comment_id, mediaId: v.post_id, senderId: String(v.from?.id || ''), text: v.message });
        }
        if (change?.field === 'comments' && v.id) {
          await this.auto.handleComment({ platform: 'instagram', commentId: v.id, mediaId: v.media?.id, senderId: String(v.from?.id || v.from?.username || ''), text: v.text });
        }
      }
      // IG messaging standby etc. ignored for MVP
      for (const m of entry?.messaging || []) {
        // optional: handle DMs follow-ups here
      }
    }
    return { received: true };
  }
}
