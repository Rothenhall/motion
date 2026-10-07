import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { HooksService } from './hooks.service';
import { Ctx, RequestContext, requireClient } from '../tenancy/ctx';
import { RequireFeature } from '../tenancy/guards';

@Controller('hooks')
@RequireFeature('content-lab')
export class HooksController {
  constructor(private hooks: HooksService) {}

  @Get()
  list(@Ctx() ctx: RequestContext, @Query('category') category?: string, @Query('platform') platform?: string, @Query('q') q?: string, @Query('favorites') favorites?: string, @Query('source') source?: string) {
    return this.hooks.list(requireClient(ctx), ctx.user.id, { category: category || undefined, platform: platform || undefined, q: q || undefined, favorites: favorites === 'true', source: source || undefined });
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() body: { text?: string; category?: string; platform?: string }) {
    return this.hooks.create(requireClient(ctx), ctx.user.id, body);
  }

  @Post('generate')
  @RequireFeature('ai')
  generate(@Ctx() ctx: RequestContext, @Body() body: { topic?: string; platform?: string; count?: number; category?: string }) {
    return this.hooks.generate(requireClient(ctx), ctx.user.id, body);
  }

  @Patch(':id/favorite')
  favorite(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.hooks.toggleFavorite(requireClient(ctx), id);
  }

  @Post(':id/use')
  use(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.hooks.markUsed(requireClient(ctx), id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.hooks.remove(requireClient(ctx), id);
  }
}
