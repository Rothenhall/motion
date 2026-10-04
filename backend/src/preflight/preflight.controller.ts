import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../auth/auth.guard';
import { CheckInput, PreflightService } from './preflight.service';

/** Pre-flight check: how people will likely react to a post, before it goes out. */
@Controller('preflight')
export class PreflightController {
  constructor(private preflight: PreflightService) {}

  @Get('status')
  status() {
    return this.preflight.status();
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.preflight.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CheckInput) {
    return this.preflight.create(user.id, body);
  }

  @Post('compare')
  compare(@CurrentUser() user: AuthUser, @Body() body: { platform?: string; caption?: string; variants?: unknown }) {
    return this.preflight.compare(user.id, body);
  }

  @Get('groups/:groupId')
  group(@CurrentUser() user: AuthUser, @Param('groupId') groupId: string) {
    return this.preflight.group(user.id, groupId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.preflight.get(user.id, id);
  }

  @Post(':id/retry')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.preflight.retry(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.preflight.remove(user.id, id);
  }
}
