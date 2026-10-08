import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { publicPost } from './approvals';
import { Ctx, RequestContext, accountScope, clientScope } from './tenancy/ctx';

const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async summary(@Ctx() ctx: RequestContext) {
    const owned = accountScope(ctx);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [accounts, scheduled, published, failed, awaitingApproval, activeAutomationCount, automationCount, upcomingPosts] = await Promise.all([
      this.prisma.socialAccount.findMany({ where: { ...clientScope(ctx), disconnectedAt: null }, orderBy: { createdAt: 'desc' }, select: accountSelect }),
      this.prisma.scheduledPost.count({ where: { ...owned, status: 'SCHEDULED' } }),
      this.prisma.scheduledPost.count({ where: { ...owned, status: 'PUBLISHED', updatedAt: { gte: startOfMonth } } }),
      this.prisma.scheduledPost.count({ where: { ...owned, status: 'FAILED' } }),
      this.prisma.scheduledPost.count({ where: { ...owned, approvalStatus: 'PENDING' } }),
      this.prisma.automationRule.count({ where: { ...owned, isActive: true } }),
      this.prisma.automationRule.count({ where: owned }),
      this.prisma.scheduledPost.findMany({
        where: { ...owned, status: 'SCHEDULED' },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
        include: { account: { select: accountSelect } },
      }),
    ]);

    return {
      // Engagement lives in /analytics, which reads synced Meta insights.
      stats: { scheduled, published, failed, awaitingApproval },
      accounts,
      upcomingPosts: upcomingPosts.map(publicPost),
      activeAutomationCount,
      automationCount,
    };
  }
}
