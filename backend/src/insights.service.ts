import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import type { SocialAccount } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { MetaService } from './meta.service';

const DAY = 86_400_000;
const BACKFILL_DAYS = 30;
// Recent days keep changing on Meta's side, so they're always re-fetched.
const SETTLE_DAYS = 2;
const POST_WINDOW_DAYS = 90;
const POSTS_PER_ACCOUNT = 50;

type Metric = 'followers' | 'views' | 'reach' | 'engagements';
type DayValues = Map<number, Partial<Record<Metric, number>>>; // key: UTC midnight ms
type PostMetrics = { views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null; shares?: number | null; saves?: number | null; engagements?: number | null };

const dayStart = (t: number | Date) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const unix = (ms: number) => Math.floor(ms / 1000);
const sum = (...xs: (number | null | undefined)[]) => {
  const present = xs.filter((x): x is number => typeof x === 'number');
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/** Value of one entry in a Graph insights response, whichever shape Meta used. */
function insightValue(entry: any): number | null {
  if (typeof entry?.total_value?.value === 'number') return entry.total_value.value;
  if (Array.isArray(entry?.values)) return sum(...entry.values.map((v: any) => (typeof v?.value === 'number' ? v.value : null)));
  return null;
}
function byName(data: any[] | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const e of data ?? []) out[e.name] = insightValue(e);
  return out;
}

/**
 * Pulls account and post insights from the Meta Graph APIs (Instagram, Facebook
 * Pages, Threads) and stores them normalized so analytics never calls Meta live.
 */
@Injectable()
export class InsightsService {
  private readonly log = new Logger(InsightsService.name);
  private running: Promise<void> | null = null;

  constructor(private prisma: PrismaService, private meta: MetaService) {}

  private v() {
    return process.env.META_GRAPH_VERSION || 'v22.0';
  }

  @Cron('15 */6 * * *')
  async scheduledSync() {
    await this.syncAll();
  }

  /** Sync every account. Concurrent callers share the in-flight run. */
  syncAll(): Promise<void> {
    if (!this.running) {
      this.running = (async () => {
        const accounts = await this.prisma.socialAccount.findMany();
        for (const a of accounts) await this.syncAccount(a);
      })().finally(() => (this.running = null));
    }
    return this.running;
  }

  isSyncing() {
    return this.running !== null;
  }

  async syncAccount(account: SocialAccount) {
    const errors: string[] = [];
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        const m = this.meta.msg(e);
        errors.push(`${label}: ${m}`);
        this.log.warn(`${label} failed for ${account.name || account.externalId}: ${m}`);
      }
    };

    await step('Post import', () => this.importPosts(account));
    await step('Account insights', () => this.syncAccountInsights(account));
    await step('Post insights', () => this.syncPostInsights(account));

    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { insightsSyncedAt: new Date(), insightsError: errors.length ? errors.join(' · ').slice(0, 500) : null },
    });
  }

  // ---------- posts published outside Motion ----------

  private importPosts(a: SocialAccount) {
    if (a.provider === 'instagram') return this.meta.importInstagramMedia(a.id, a.accessToken);
    if (a.provider === 'threads') return this.meta.importThreads(a.id, a.accessToken);
    return this.meta.importFacebookPosts(a.id, a.externalId, a.accessToken);
  }

  // ---------- account-level, per day ----------

  private async syncAccountInsights(a: SocialAccount) {
    const today = dayStart(Date.now());
    const known = await this.prisma.accountInsight.findMany({
      where: { accountId: a.id, metric: { not: 'followers' }, date: { gte: new Date(today - BACKFILL_DAYS * DAY) } },
      select: { date: true },
      distinct: ['date'],
    });
    const have = new Set(known.map((k) => k.date.getTime()));
    // Completed days only; today is partial until tomorrow.
    const missing: number[] = [];
    for (let i = 1; i <= BACKFILL_DAYS; i++) {
      const d = today - i * DAY;
      if (i <= SETTLE_DAYS || !have.has(d)) missing.push(d);
    }

    let values: DayValues;
    let followers: number | null;
    if (a.provider === 'instagram') [values, followers] = await Promise.all([this.igDays(a, missing), this.igFollowers(a)]);
    else if (a.provider === 'threads') [values, followers] = await Promise.all([this.threadsDays(a, missing), this.threadsFollowers(a)]);
    else [values, followers] = await Promise.all([this.fbDays(a, missing), this.fbFollowers(a)]);

    if (followers != null) values.set(today, { ...(values.get(today) ?? {}), followers });
    await this.storeDays(a.id, values);
  }

  private async storeDays(accountId: string, values: DayValues) {
    for (const [day, metrics] of values) {
      for (const [metric, value] of Object.entries(metrics)) {
        if (typeof value !== 'number') continue;
        const date = new Date(day);
        await this.prisma.accountInsight.upsert({
          where: { accountId_date_metric: { accountId, date, metric } },
          create: { accountId, date, metric, value: Math.round(value) },
          update: { value: Math.round(value) },
        });
      }
    }
  }

  // Instagram API with Instagram Login. total_value metrics need one call per day.
  private async igDays(a: SocialAccount, days: number[]): Promise<DayValues> {
    const out: DayValues = new Map();
    for (const d of days) {
      const r = await axios.get(`https://graph.instagram.com/${this.v()}/${a.externalId}/insights`, {
        params: {
          metric: 'views,reach,total_interactions',
          period: 'day',
          metric_type: 'total_value',
          since: unix(d),
          until: unix(d + DAY),
          access_token: a.accessToken,
        },
      });
      const m = byName(r.data?.data);
      out.set(d, { views: m.views ?? undefined, reach: m.reach ?? undefined, engagements: m.total_interactions ?? undefined });
    }
    return out;
  }

  private async igFollowers(a: SocialAccount) {
    const r = await axios.get(`https://graph.instagram.com/${this.v()}/me`, {
      params: { fields: 'followers_count', access_token: a.accessToken },
    });
    return typeof r.data?.followers_count === 'number' ? r.data.followers_count : null;
  }

  // Threads: views is a daily series, the rest are totals for the window.
  private async threadsDays(a: SocialAccount, days: number[]): Promise<DayValues> {
    const out: DayValues = new Map();
    for (const d of days) {
      const r = await axios.get(`https://graph.threads.net/v1.0/${a.externalId}/threads_insights`, {
        params: { metric: 'views,likes,replies,reposts,quotes', since: unix(d), until: unix(d + DAY) - 1, access_token: a.accessToken },
      });
      const m = byName(r.data?.data);
      out.set(d, { views: m.views ?? undefined, engagements: sum(m.likes, m.replies, m.reposts, m.quotes) ?? undefined });
    }
    return out;
  }

  private async threadsFollowers(a: SocialAccount) {
    const r = await axios.get(`https://graph.threads.net/v1.0/${a.externalId}/threads_insights`, {
      params: { metric: 'followers_count', access_token: a.accessToken },
    });
    return byName(r.data?.data).followers_count ?? null;
  }

  // Facebook Pages: period=day returns a daily series in one call per metric.
  // Meta replaced impressions with "media view" metrics; older names are fallbacks.
  private async fbDays(a: SocialAccount, days: number[]): Promise<DayValues> {
    const out: DayValues = new Map();
    if (!days.length) return out;
    const since = Math.min(...days);
    const until = Math.max(...days) + DAY;
    const want = new Set(days);
    const candidates: [Metric, string[]][] = [
      ['views', ['page_media_view', 'page_impressions']],
      ['reach', ['page_total_media_view_unique', 'page_impressions_unique']],
      ['engagements', ['page_post_engagements']],
    ];
    let lastError: unknown = null;
    let gotAny = false;
    for (const [metric, names] of candidates) {
      for (const name of names) {
        try {
          const r = await axios.get(`https://graph.facebook.com/${this.v()}/${a.externalId}/insights`, {
            params: { metric: name, period: 'day', since: unix(since), until: unix(until), access_token: a.accessToken },
          });
          for (const v of r.data?.data?.[0]?.values ?? []) {
            if (typeof v?.value !== 'number' || !v.end_time) continue;
            // end_time marks the end of the reported day.
            const d = dayStart(new Date(v.end_time).getTime() - DAY);
            if (!want.has(d)) continue;
            out.set(d, { ...(out.get(d) ?? {}), [metric]: v.value });
          }
          gotAny = true;
          break;
        } catch (e) {
          lastError = e;
        }
      }
    }
    if (!gotAny && lastError) throw lastError;
    return out;
  }

  private async fbFollowers(a: SocialAccount) {
    const r = await axios.get(`https://graph.facebook.com/${this.v()}/${a.externalId}`, {
      params: { fields: 'followers_count,fan_count', access_token: a.accessToken },
    });
    return r.data?.followers_count ?? r.data?.fan_count ?? null;
  }

  // ---------- post-level, lifetime ----------

  private async syncPostInsights(a: SocialAccount) {
    const posts = await this.prisma.scheduledPost.findMany({
      where: {
        accountId: a.id,
        status: 'PUBLISHED',
        externalId: { not: null },
        scheduledAt: { gte: new Date(Date.now() - POST_WINDOW_DAYS * DAY) },
      },
      orderBy: { scheduledAt: 'desc' },
      take: POSTS_PER_ACCOUNT,
      select: { id: true, externalId: true },
    });
    let failures = 0;
    let lastError: unknown = null;
    for (const p of posts) {
      try {
        const m =
          a.provider === 'instagram' ? await this.igPost(a, p.externalId!)
          : a.provider === 'threads' ? await this.threadsPost(a, p.externalId!)
          : await this.fbPost(a, p.externalId!);
        const data = { ...m, fetchedAt: new Date() };
        await this.prisma.postInsight.upsert({
          where: { postId: p.id },
          create: { postId: p.id, accountId: a.id, ...data },
          update: data,
        });
      } catch (e) {
        failures++;
        lastError = e;
      }
    }
    if (posts.length && failures === posts.length) throw lastError;
  }

  /** Requests all metrics at once; if Meta rejects one (unsupported for this media type), asks one by one. */
  private async metricsFor(url: string, metrics: string[], params: Record<string, string>) {
    try {
      const r = await axios.get(url, { params: { ...params, metric: metrics.join(',') } });
      return byName(r.data?.data);
    } catch {
      const out: Record<string, number | null> = {};
      for (const metric of metrics) {
        try {
          const r = await axios.get(url, { params: { ...params, metric } });
          Object.assign(out, byName(r.data?.data));
        } catch {
          /* not available for this post */
        }
      }
      return out;
    }
  }

  private async igPost(a: SocialAccount, mediaId: string): Promise<PostMetrics> {
    const base = `https://graph.instagram.com/${this.v()}/${mediaId}`;
    const fields = await axios.get(base, { params: { fields: 'like_count,comments_count,permalink', access_token: a.accessToken } });
    const m = await this.metricsFor(`${base}/insights`, ['views', 'reach', 'saved', 'shares', 'total_interactions'], { access_token: a.accessToken });
    if (fields.data?.permalink) await this.setPermalink(a.id, mediaId, fields.data.permalink);
    const likes = fields.data?.like_count ?? null;
    const comments = fields.data?.comments_count ?? null;
    return {
      views: m.views ?? null,
      reach: m.reach ?? null,
      likes,
      comments,
      shares: m.shares ?? null,
      saves: m.saved ?? null,
      engagements: m.total_interactions ?? sum(likes, comments, m.shares, m.saved),
    };
  }

  private async threadsPost(a: SocialAccount, mediaId: string): Promise<PostMetrics> {
    const m = await this.metricsFor(`https://graph.threads.net/v1.0/${mediaId}/insights`, ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'], {
      access_token: a.accessToken,
    });
    if (!Object.keys(m).length) throw new Error('No Threads insights returned');
    return {
      views: m.views ?? null,
      likes: m.likes ?? null,
      comments: m.replies ?? null,
      shares: sum(m.reposts, m.quotes, m.shares),
      engagements: sum(m.likes, m.replies, m.reposts, m.quotes),
    };
  }

  private async fbPost(a: SocialAccount, postId: string): Promise<PostMetrics> {
    const base = `https://graph.facebook.com/${this.v()}/${postId}`;
    const r = await axios.get(base, {
      params: { fields: 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)', access_token: a.accessToken },
    });
    const likes = r.data?.reactions?.summary?.total_count ?? null;
    const comments = r.data?.comments?.summary?.total_count ?? null;
    // Photos and videos don't have shares/permalink_url; only feed posts do.
    let shares: number | null = null;
    try {
      const s = await axios.get(base, { params: { fields: 'shares,permalink_url', access_token: a.accessToken } });
      shares = s.data?.shares?.count ?? 0;
      if (s.data?.permalink_url) await this.setPermalink(a.id, postId, s.data.permalink_url);
    } catch {
      /* not a feed post */
    }
    const m = await this.metricsFor(`${base}/insights`, ['post_media_view', 'post_impressions', 'post_total_media_view_unique', 'post_impressions_unique'], {
      access_token: a.accessToken,
    });
    return {
      views: m.post_media_view ?? m.post_impressions ?? null,
      reach: m.post_total_media_view_unique ?? m.post_impressions_unique ?? null,
      likes,
      comments,
      shares,
      engagements: sum(likes, comments, shares),
    };
  }

  private async setPermalink(accountId: string, externalId: string, permalink: string) {
    await this.prisma.scheduledPost.updateMany({ where: { accountId, externalId, permalink: null }, data: { permalink } });
  }
}
