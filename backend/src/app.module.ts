import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { UsersController } from './auth/users.controller';
import { AuthGuard } from './auth/auth.guard';
import { InsightsService } from './insights.service';
import { AnalyticsController } from './analytics.controller';
import { AiService } from './ai/ai.service';
import { IdeasService } from './ai/ideas.service';
import { IdeasController } from './ai/ideas.controller';
import { HooksService } from './ai/hooks.service';
import { HooksController } from './ai/hooks.controller';
import { PreflightController } from './preflight/preflight.controller';
import { PreflightService } from './preflight/preflight.service';
import { TribeClient } from './preflight/tribe.client';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [UsersController, AuthController, PostsController, AccountsController, AutomationsController, CommentsController, WebhooksController, DashboardController, MediaController, AnalyticsController, IdeasController, HooksController, PreflightController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, PrismaService, SchedulerService, PublishersService, AutomationsService, MetaService, InsightsService, AiService, IdeasService, HooksService, TribeClient, PreflightService],
})
export class AppModule {}
