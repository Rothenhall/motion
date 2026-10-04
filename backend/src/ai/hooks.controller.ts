import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { HooksService } from './hooks.service';

@Controller('hooks')
export class HooksController {
  constructor(private hooks: HooksService) {}

  @Get()
  list(@Query('category') category?: string, @Query('platform') platform?: string, @Query('q') q?: string, @Query('favorites') favorites?: string, @Query('source') source?: string) {
    return this.hooks.list({ category: category || undefined, platform: platform || undefined, q: q || undefined, favorites: favorites === 'true', source: source || undefined });
  }

  @Post()
  create(@Body() body: { text?: string; category?: string; platform?: string }) {
    return this.hooks.create(body);
  }

  @Post('generate')
  generate(@Body() body: { topic?: string; platform?: string; count?: number; category?: string }) {
    return this.hooks.generate(body);
  }

  @Patch(':id/favorite')
  favorite(@Param('id') id: string) {
    return this.hooks.toggleFavorite(id);
  }

  @Post(':id/use')
  use(@Param('id') id: string) {
    return this.hooks.markUsed(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.hooks.remove(id);
  }
}
