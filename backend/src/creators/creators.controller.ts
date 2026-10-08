import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, RequestContext, requireClient } from '../tenancy/ctx';
import { RequireFeature } from '../tenancy/guards';
import { CreatorResult } from './creators.constants';
import { CreatorsService } from './creators.service';

@Controller()
export class CreatorsController {
  constructor(private creators: CreatorsService) {}

  @Post('creators/chat')
  @RequireFeature('creators', 'ai')
  chat(@Ctx() ctx: RequestContext, @Body() body: { messages?: { role?: string; content?: string }[] }) {
    return this.creators.chat(requireClient(ctx), ctx.user.id, (body.messages ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content ?? '' })));
  }

  @Post('creators/search')
  @RequireFeature('creators')
  search(@Ctx() ctx: RequestContext, @Body() body: { criteria?: Partial<CreatorResult & { creatorCountries?: string[]; creatorMinFollowers?: number; creatorMaxFollowers?: number; creatorInterests?: string[]; creatorGender?: string; creatorAgeBucket?: string; majorAudienceCountries?: string[]; recommendationType?: string; similarTo?: string[] }>; limit?: number }) {
    return this.creators.search(requireClient(ctx), body.criteria ?? {}, body.limit);
  }

  @Get('creators/shortlist')
  @RequireFeature('creators')
  list(@Ctx() ctx: RequestContext) {
    return this.creators.listShortlist(requireClient(ctx));
  }

  @Post('creators/shortlist')
  @RequireFeature('creators')
  save(@Ctx() ctx: RequestContext, @Body() body: CreatorResult) {
    return this.creators.shortlist(requireClient(ctx), ctx.user.id, body);
  }

  @Delete('creators/shortlist/:id')
  @HttpCode(204)
  @RequireFeature('creators')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.creators.removeShortlist(requireClient(ctx), id);
  }
}
