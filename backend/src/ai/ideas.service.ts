import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { BrandContext, ClaudeService, PLATFORMS } from './claude.service';

export type ProfileInput = { niche?: string; audience?: string; voice?: string; pillars?: unknown; platforms?: unknown; autopilot?: boolean; ideasPerRun?: number };

const MAX_IDEAS = 10;
// Autopilot runs once a day; this guard keeps restarts and overlapping ticks from double-generating.
const AUTOPILOT_GAP_MS = 20 * 60 * 60 * 1000;

function parseList(value: string | null | undefined): string[] {
  try { const list = JSON.parse(value || '[]'); return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : []; } catch { return []; }
}

function cleanList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new BadRequestException(`${field} must be a list of text.`);
  return [...new Set(value.map((v) => v.trim()).filter(Boolean))].slice(0, 12);
}

@Injectable()
export class IdeasService {
  private readonly log = new Logger(IdeasService.name);

  constructor(private prisma: PrismaService, private claude: ClaudeService) {}

  // ---- brand profile (one per user) ----

  async getProfile(userId: string) {
    const profile = await this.prisma.brandProfile.findUnique({ where: { userId } });
    return profile ? serializeProfile(profile) : null;
  }

  async saveProfile(userId: string, body: ProfileInput) {
    const niche = body.niche?.trim();
    if (!niche) throw new BadRequestException('Describe what your brand posts about.');
    const platforms = cleanList(body.platforms, 'Platforms');
    if (platforms.some((p) => !(PLATFORMS as readonly string[]).includes(p))) throw new BadRequestException('Choose supported platforms.');
    const ideasPerRun = body.ideasPerRun ?? 5;
    if (!Number.isInteger(ideasPerRun) || ideasPerRun < 1 || ideasPerRun > MAX_IDEAS) throw new BadRequestException(`Ideas per day must be between 1 and ${MAX_IDEAS}.`);
    const data = {
      niche,
      audience: body.audience?.trim() || null,
      voice: body.voice?.trim() || null,
      pillars: JSON.stringify(cleanList(body.pillars, 'Pillars')),
      platforms: JSON.stringify(platforms.length ? platforms : ['instagram']),
      autopilot: Boolean(body.autopilot),
      ideasPerRun,
    };
    const saved = await this.prisma.brandProfile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
    return serializeProfile(saved);
  }

  // ---- ideas ----

  async list(userId: string, status?: string) {
    const ideas = await this.prisma.contentIdea.findMany({
      where: { userId, ...(status ? { status } : { status: { not: 'DISMISSED' } }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ideas.map(serializeIdea);
  }

  async generate(userId: string, opts: { topic?: string; platform?: string; count?: number; source?: 'MANUAL' | 'AUTOPILOT' }) {
    const profile = await this.getProfile(userId);
    if (!profile) throw new BadRequestException('Set up your brand profile first so ideas fit your niche.');
    const count = opts.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > MAX_IDEAS) throw new BadRequestException(`Ask for between 1 and ${MAX_IDEAS} ideas.`);
    if (opts.platform && !(PLATFORMS as readonly string[]).includes(opts.platform)) throw new BadRequestException('Choose a supported platform.');
    const topic = opts.topic?.trim().slice(0, 300) || undefined;

    const [recent, favorites] = await Promise.all([
      this.prisma.contentIdea.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, select: { title: true } }),
      this.prisma.hook.findMany({ where: { userId, isFavorite: true }, orderBy: { usedCount: 'desc' }, take: 8, select: { text: true } }),
    ]);
    const brand: BrandContext = { niche: profile.niche, audience: profile.audience, voice: profile.voice, pillars: profile.pillars };
    const ideas = await this.claude.generateIdeas({
      brand,
      platforms: opts.platform ? [opts.platform] : profile.platforms,
      count,
      topic,
      avoid: recent.map((r) => r.title),
      favoriteHooks: favorites.map((f) => f.text),
    });

    const source = opts.source ?? 'MANUAL';
    const created = await this.prisma.$transaction(ideas.map((idea) => this.prisma.contentIdea.create({
      data: {
        userId,
        title: idea.title.trim(),
        hook: idea.hook.trim(),
        angle: idea.angle.trim() || null,
        format: idea.format,
        platform: idea.platform,
        pillar: idea.pillar.trim() || null,
        caption: idea.caption.trim() || null,
        hashtags: JSON.stringify(idea.hashtags.map((h) => h.replace(/^#/, '').trim()).filter(Boolean)),
        source,
        topic: topic ?? null,
      },
    })));
    return created.map(serializeIdea);
  }

  async setStatus(userId: string, id: string, status?: string) {
    if (!status || !['NEW', 'SAVED', 'USED', 'DISMISSED'].includes(status)) throw new BadRequestException('Choose a supported status.');
    const idea = await this.prisma.contentIdea.findFirst({ where: { id, userId }, select: { id: true } });
    if (!idea) throw new NotFoundException('Idea not found.');
    return serializeIdea(await this.prisma.contentIdea.update({ where: { id }, data: { status } }));
  }

  async remove(userId: string, id: string) {
    await this.prisma.contentIdea.deleteMany({ where: { id, userId } });
  }

  // ---- autopilot ----

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async autopilot() {
    if (!this.claude.configured) return;
    const profiles = await this.prisma.brandProfile.findMany({ where: { autopilot: true }, orderBy: { createdAt: 'asc' } });
    for (const profile of profiles) {
      if (profile.lastAutopilotAt && Date.now() - profile.lastAutopilotAt.getTime() < AUTOPILOT_GAP_MS) continue;
      await this.prisma.brandProfile.update({ where: { id: profile.id }, data: { lastAutopilotAt: new Date() } });
      try {
        const ideas = await this.generate(profile.userId, { count: profile.ideasPerRun, source: 'AUTOPILOT' });
        this.log.log(`Autopilot added ${ideas.length} ideas for user ${profile.userId}`);
      } catch (error) {
        this.log.error(`Autopilot failed for user ${profile.userId}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

function serializeProfile<T extends { pillars: string; platforms: string }>(profile: T) {
  return { ...profile, pillars: parseList(profile.pillars), platforms: parseList(profile.platforms) };
}

function serializeIdea<T extends { hashtags: string }>(idea: T) {
  return { ...idea, hashtags: parseList(idea.hashtags) };
}
