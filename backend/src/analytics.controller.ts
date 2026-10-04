import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { InsightsService } from './insights.service';
import { AuthUser, CurrentUser } from './auth/auth.guard';

const DAY = 86_400_000;
const RANGES = [7, 30, 90];

const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const rate = (engagements: number, views: number) => (views > 0 ? Math.round((engagements / views) * 1000) / 10 : null);

@Controller('analytics')
export class AnalyticsController {
  constructor(private prisma: PrismaService, private insights: InsightsService) {}

  @Get()
  async summary(@CurrentUser() user: AuthUser, @Query('days') daysParam?: string) {
    const owned = { account: { userId: user.id } };
    const days = RANGES.includes(Number(daysParam)) ? Number(daysParam) : 30;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    // Completed days only: [since, today). The previous period is the same length right before it.
    const since = today - days * DAY;
    const prevSince = since - days * DAY;

    const [accounts, rows, followerRows, published, prevPublished, topPosts] = await Promise.all([
      this.prisma.socialAccount.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, provider: true, name: true, insightsSyncedAt: true, insightsError: true },
      }),
      this.prisma.accountInsight.findMany({
        where: { ...owned, metric: { in: ['views', 'reach', 'engagements'] }, date: { gte: new Date(prevSince), lt: new Date(today) } },
        select: { accountId: true, date: true, metric: true, value: true },
      }),
      this.prisma.accountInsight.findMany({
        where: { ...owned, metric: 'followers' },
        orderBy: { date: 'desc' },
        distinct: ['accountId'],
        select: { accountId: true, value: true },
      }),
      this.prisma.scheduledPost.count({ where: { ...owned, status: 'PUBLISHED', scheduledAt: { gte: new Date(since), lt: now } } }),
      this.prisma.scheduledPost.count({ where: { ...owned, status: 'PUBLISHED', scheduledAt: { gte: new Date(prevSince), lt: new Date(since) } } }),
      this.prisma.postInsight.findMany({
        where: { ...owned, post: { scheduledAt: { gte: new Date(since) } } },
        orderBy: [{ engagements: 'desc' }, { views: 'desc' }],
        take: 5,
        include: { post: { select: { platform: true, caption: true, mediaType: true, permalink: true, scheduledAt: true } } },
      }),
    ]);

    const empty = () => ({ views: 0, reach: 0, engagements: 0 });
    const current = empty();
    const previous = empty();
    const perAccount = new Map<string, ReturnType<typeof empty>>();
    const perDay = new Map<number, { views: number; engagements: number }>();
    for (let d = since; d < today; d += DAY) perDay.set(d, { views: 0, engagements: 0 });

    for (const r of rows) {
      const t = r.date.getTime();
      const key = r.metric as 'views' | 'reach' | 'engagements';
      if (t < since) {
        previous[key] += r.value;
        continue;
      }
      current[key] += r.value;
      const acc = perAccount.get(r.accountId) ?? empty();
      acc[key] += r.value;
      perAccount.set(r.accountId, acc);
      const day = perDay.get(t);
      if (day && key !== 'reach') day[key] += r.value;
    }

    const followers = new Map(followerRows.map((f) => [f.accountId, f.value]));
    const totalEngagements = current.engagements;
    const channels = accounts
      .map((a) => {
        const m = perAccount.get(a.id) ?? empty();
        return {
          accountId: a.id,
          provider: a.provider,
          name: a.name,
          views: m.views,
          engagements: m.engagements,
          engagementRate: rate(m.engagements, m.views),
          followers: followers.get(a.id) ?? null,
          share: totalEngagements > 0 ? Math.round((m.engagements / totalEngagements) * 100) : 0,
          syncedAt: a.insightsSyncedAt,
          error: a.insightsError,
        };
      })
      .sort((x, y) => y.engagements - x.engagements || y.views - x.views);

    const syncTimes = accounts.map((a) => a.insightsSyncedAt?.getTime()).filter((t): t is number => !!t);
    const currentRate = rate(current.engagements, current.views);
    const previousRate = rate(previous.engagements, previous.views);

    return {
      range: { days, since: new Date(since), until: new Date(today) },
      hasInsights: rows.length > 0 || followerRows.length > 0,
      syncing: this.insights.isSyncing(),
      lastSyncedAt: syncTimes.length ? new Date(Math.min(...syncTimes)) : null,
      totals: {
        views: current.views,
        viewsChange: pctChange(current.views, previous.views),
        reach: current.reach,
        engagements: current.engagements,
        engagementRate: currentRate,
        engagementRateChange: currentRate != null && previousRate != null ? Math.round((currentRate - previousRate) * 10) / 10 : null,
        published,
        publishedChange: pctChange(published, prevPublished),
        followers: followers.size ? [...followers.values()].reduce((a, b) => a + b, 0) : null,
      },
      series: [...perDay.entries()].map(([d, v]) => ({ date: new Date(d), ...v })),
      channels,
      topPosts: topPosts.map((p) => ({
        id: p.postId,
        platform: p.post.platform,
        caption: p.post.caption,
        mediaType: p.post.mediaType,
        permalink: p.post.permalink,
        publishedAt: p.post.scheduledAt,
        views: p.views,
        engagements: p.engagements,
      })),
    };
  }

  /** Kicks off a sync and returns immediately; poll GET /analytics for `syncing`. */
  @Post('sync')
  @HttpCode(202)
  sync() {
    this.insights.syncAll().catch(() => undefined);
    return { syncing: true };
  }
}
