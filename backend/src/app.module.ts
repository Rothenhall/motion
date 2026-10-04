import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { AuthController } from './auth.controller';
import { PostsController } from './posts.controller';
import { AccountsController } from './accounts.controller';
import { AutomationsController } from './automations.controller';
import { CommentsController } from './comments.controller';
import { WebhooksController } from './webhooks.controller';
import { MediaController } from './media.controller';
import { SchedulerService } from './scheduler.service';
import { PublishersService } from './publishers.service';
import { AutomationsService } from './automations.service';
import { MetaService } from './meta.service';
import { DashboardController } from './dashboard.controller';
import { ClaudeService } from './ai/claude.service';
import { IdeasService } from './ai/ideas.service';
import { IdeasController } from './ai/ideas.controller';
import { HooksService } from './ai/hooks.service';
import { HooksController } from './ai/hooks.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [AuthController, PostsController, AccountsController, AutomationsController, CommentsController, WebhooksController, DashboardController, MediaController, IdeasController, HooksController],
  providers: [PrismaService, SchedulerService, PublishersService, AutomationsService, MetaService, ClaudeService, IdeasService, HooksService],
})
export class AppModule {}
