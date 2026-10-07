import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IdeasService, ProfileInput } from './ideas.service';
import { AiService } from './ai.service';
import { Ctx, RequestContext, requireClient } from '../tenancy/ctx';
import { RequireFeature } from '../tenancy/guards';

@Controller()
export class IdeasController {
  constructor(private ideas: IdeasService, private ai: AiService) {}

  @Get('ai/status')
  status() {
    return { configured: this.ai.configured, model: this.ai.model };
  }

  @Get('brand-profile')
  @RequireFeature('content-lab')
  profile(@Ctx() ctx: RequestContext) {
    return this.ideas.getProfile(requireClient(ctx));
  }

  @Put('brand-profile')
  @RequireFeature('content-lab', 'edit-brand')
  saveProfile(@Ctx() ctx: RequestContext, @Body() body: ProfileInput) {
    return this.ideas.saveProfile(requireClient(ctx), ctx.user.id, body);
  }

  @Get('ideas')
  @RequireFeature('content-lab')
  list(@Ctx() ctx: RequestContext, @Query('status') status?: string) {
    return this.ideas.list(requireClient(ctx), status || undefined);
  }

  @Post('ideas/generate')
  @RequireFeature('content-lab', 'ai')
  generate(@Ctx() ctx: RequestContext, @Body() body: { topic?: string; platform?: string; count?: number }) {
    return this.ideas.generate(requireClient(ctx), ctx.user.id, { topic: body.topic, platform: body.platform || undefined, count: body.count });
  }

  @Patch('ideas/:id')
  @RequireFeature('content-lab')
  setStatus(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { status?: string }) {
    return this.ideas.setStatus(requireClient(ctx), id, body.status);
  }

  @Delete('ideas/:id')
  @HttpCode(204)
  @RequireFeature('content-lab')
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.ideas.remove(requireClient(ctx), id);
  }
}
