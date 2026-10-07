import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, RequestContext, requireClient } from '../tenancy/ctx';
import { RequireFeature } from '../tenancy/guards';
import { CheckInput, PreflightService } from './preflight.service';

/** Pre-flight check: how people will likely react to a post, before it goes out. Limited to the acting client's checks. */
@Controller('preflight')
@RequireFeature('preflight')
export class PreflightController {
  constructor(private preflight: PreflightService) {}

  @Get('status')
  status() {
    return this.preflight.status();
  }

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.preflight.list(requireClient(ctx));
  }

  // Running a check uses the AI (and sometimes a GPU), which costs the agency money, so it needs the AI switch.
  @Post()
  @RequireFeature('ai')
  create(@Ctx() ctx: RequestContext, @Body() body: CheckInput) {
    return this.preflight.create(requireClient(ctx), ctx.user.id, body);
  }

  @Post('compare')
  @RequireFeature('ai')
  compare(@Ctx() ctx: RequestContext, @Body() body: { platform?: string; caption?: string; variants?: unknown }) {
    return this.preflight.compare(requireClient(ctx), ctx.user.id, body);
  }

  @Get('groups/:groupId')
  group(@Ctx() ctx: RequestContext, @Param('groupId') groupId: string) {
    return this.preflight.group(requireClient(ctx), groupId);
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.preflight.get(requireClient(ctx), id);
  }

  @Get(':id/brain')
  brain(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.preflight.brain(requireClient(ctx), id);
  }

  /** Fill in the brain view for an older reel check: free from cache, or a new GPU run when allowFresh is true. */
  @Post(':id/brain')
  @RequireFeature('ai')
  loadBrain(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() body: { allowFresh?: boolean }) {
    return this.preflight.loadBrain(requireClient(ctx), id, body?.allowFresh === true);
  }

  @Post(':id/retry')
  @RequireFeature('ai')
  retry(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.preflight.retry(requireClient(ctx), id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.preflight.remove(requireClient(ctx), id);
  }
}
