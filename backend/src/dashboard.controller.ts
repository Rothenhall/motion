import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

const accountSelect = { id: true, provider: true, externalId: true, name: true, tokenExpires: true, createdAt: true } as const;

@Controller('dashboard')
export class DashboardController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async summary() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [accounts, scheduled, published, failed, activeAutomationCount, automationCount, upcomingPosts] = await Promise.all([
      this.prisma.socialAccount.findMany({ orderBy: { createdAt: 'desc' }, select: accountSelect }),
      this.prisma.scheduledPost.count({ where: { status: 'SCHEDULED' } }),
      this.prisma.scheduledPost.count({ where: { status: 'PUBLISHED', updatedAt: { gte: startOfMonth } } }),
      this.prisma.scheduledPost.count({ where: { status: 'FAILED' } }),
      this.prisma.automationRule.count({ where: { isActive: true } }),
      this.prisma.automationRule.count(),
      this.prisma.scheduledPost.findMany({
        where: { status: 'SCHEDULED' },
        orderBy: { scheduledAt: 'asc' },
        take: 8,
        include: { account: { select: accountSelect } },
      }),
    ]);

    return {
      stats: {
        scheduled,
        published,
        failed,
        // Engagement metrics are intentionally nullable until platform insights are connected.
        engagement: null,
        engagementChange: null,
      },
      accounts,
      upcomingPosts,
      activeAutomationCount,
      automationCount,
    };
  }
}
