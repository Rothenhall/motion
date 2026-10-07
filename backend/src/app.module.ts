import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerOptions } from './rate-limit';
import { PrismaService } from './prisma.service';
import { AuthController } from './auth.controller';
import { PostsController } from './posts.controller';
import { DraftsController } from './drafts.controller';
import { AccountsController } from './accounts.controller';
import { AutomationsController } from './automations.controller';
import { CommentsController } from './comments.controller';
import { WebhooksController } from './webhooks.controller';
import { MediaController } from './media.controller';
import { SchedulerService } from './scheduler.service';
import { UploadsCleanupService } from './uploads-cleanup.service';
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
import { FeaturesService } from './tenancy/features.service';
import { ClientsService } from './tenancy/clients.service';
import { TenancyBackfillService } from './tenancy/backfill.service';
import { MediaOwnershipService } from './tenancy/media-ownership.service';
import { FeatureGuard, RolesGuard } from './tenancy/guards';
import { AuditService } from './tenancy/audit.service';
import { InvitesService } from './auth/invites.service';
import { InvitesController } from './auth/invites.controller';
import { TeamService } from './auth/team.service';
import { TeamController } from './team.controller';
import { AdminClientsController } from './admin/admin-clients.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), ThrottlerModule.forRoot(throttlerOptions)],
  controllers: [UsersController, InvitesController, TeamController, AdminClientsController, AuthController, PostsController, DraftsController, AccountsController, AutomationsController, CommentsController, WebhooksController, DashboardController, MediaController, AnalyticsController, IdeasController, HooksController, PreflightController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: RolesGuard }, { provide: APP_GUARD, useClass: FeatureGuard }, PrismaService, SchedulerService, UploadsCleanupService, PublishersService, AutomationsService, MetaService, InsightsService, AiService, IdeasService, HooksService, TribeClient, PreflightService, FeaturesService, ClientsService, TenancyBackfillService, MediaOwnershipService, AuditService, InvitesService, TeamService],
})
export class AppModule {}
