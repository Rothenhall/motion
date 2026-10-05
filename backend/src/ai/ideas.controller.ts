import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IdeasService, ProfileInput } from './ideas.service';
import { AiService } from './ai.service';
import { AuthUser, CurrentUser } from '../auth/auth.guard';

@Controller()
export class IdeasController {
  constructor(private ideas: IdeasService, private ai: AiService) {}

  @Get('ai/status')
  status() {
    return { configured: this.ai.configured, model: this.ai.model };
  }

  @Get('brand-profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.ideas.getProfile(user.id);
  }

  @Put('brand-profile')
  saveProfile(@CurrentUser() user: AuthUser, @Body() body: ProfileInput) {
    return this.ideas.saveProfile(user.id, body);
  }

  @Get('ideas')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.ideas.list(user.id, status || undefined);
  }

  @Post('ideas/generate')
  generate(@CurrentUser() user: AuthUser, @Body() body: { topic?: string; platform?: string; count?: number }) {
    return this.ideas.generate(user.id, { topic: body.topic, platform: body.platform || undefined, count: body.count });
  }

  @Patch('ideas/:id')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { status?: string }) {
    return this.ideas.setStatus(user.id, id, body.status);
  }

  @Delete('ideas/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ideas.remove(user.id, id);
  }
}
