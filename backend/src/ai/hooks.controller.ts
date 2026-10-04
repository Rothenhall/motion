import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { HooksService } from './hooks.service';
import { AuthUser, CurrentUser } from '../auth/auth.guard';

@Controller('hooks')
export class HooksController {
  constructor(private hooks: HooksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('category') category?: string, @Query('platform') platform?: string, @Query('q') q?: string, @Query('favorites') favorites?: string, @Query('source') source?: string) {
    return this.hooks.list(user.id, { category: category || undefined, platform: platform || undefined, q: q || undefined, favorites: favorites === 'true', source: source || undefined });
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: { text?: string; category?: string; platform?: string }) {
    return this.hooks.create(user.id, body);
  }

  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() body: { topic?: string; platform?: string; count?: number; category?: string }) {
    return this.hooks.generate(user.id, body);
  }

  @Patch(':id/favorite')
  favorite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hooks.toggleFavorite(user.id, id);
  }

  @Post(':id/use')
  use(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hooks.markUsed(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.hooks.remove(user.id, id);
  }
}
