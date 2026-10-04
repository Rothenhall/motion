import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { IdeasService, ProfileInput } from './ideas.service';
import { ClaudeService } from './claude.service';

@Controller()
export class IdeasController {
  constructor(private ideas: IdeasService, private claude: ClaudeService) {}

  @Get('ai/status')
  status() {
    return { configured: this.claude.configured, model: this.claude.model };
  }

  @Get('brand-profile')
  profile() {
    return this.ideas.getProfile();
  }

  @Put('brand-profile')
  saveProfile(@Body() body: ProfileInput) {
    return this.ideas.saveProfile(body);
  }

  @Get('ideas')
  list(@Query('status') status?: string) {
    return this.ideas.list(status || undefined);
  }

  @Post('ideas/generate')
  generate(@Body() body: { topic?: string; platform?: string; count?: number }) {
    return this.ideas.generate({ topic: body.topic, platform: body.platform || undefined, count: body.count });
  }

  @Patch('ideas/:id')
  setStatus(@Param('id') id: string, @Body() body: { status?: string }) {
    return this.ideas.setStatus(id, body.status);
  }

  @Delete('ideas/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.ideas.remove(id);
  }
}
