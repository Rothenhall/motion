import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import { BrandContext, AiService, PLATFORMS } from './ai.service';
import { FeaturesService } from '../tenancy/features.service';

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

  constructor(private prisma: PrismaService, private ai: AiService, private features: FeaturesService) {}

  // ---- brand profile (one per client) ----

  async getProfile(clientId: string) {
    const profile = await this.prisma.brandProfile.findUnique({ where: { clientId } });
    return profile ? serializeProfile(profile) : null;
  }

  async saveProfile(clientId: string, userId: string, body: ProfileInput) {
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
    const saved = await this.prisma.brandProfile.upsert({ where: { clientId }, update: { ...data, userId }, create: { clientId, userId, ...data } });
    return serializeProfile(saved);
  }

  // ---- ideas ----

  async list(clientId: string, status?: string) {
    const ideas = await this.prisma.contentIdea.findMany({
      where: { clientId, ...(status ? { status } : { status: { not: 'DISMISSED' } }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ideas.map(serializeIdea);
  }

  async generate(clientId: string, userId: string, opts: { topic?: string; platform?: string; count?: number; source?: 'MANUAL' | 'AUTOPILOT' }) {
    const profile = await this.getProfile(clientId);
    if (!profile) throw new BadRequestException('Set up your brand profile first so ideas fit your niche.');
    const count = opts.count ?? 5;
    if (!Number.isInteger(count) || count < 1 || count > MAX_IDEAS) throw new BadRequestException(`Ask for between 1 and ${MAX_IDEAS} ideas.`);
    if (opts.platform && !(PLATFORMS as readonly string[]).includes(opts.platform)) throw new BadRequestException('Choose a supported platform.');
    const topic = opts.topic?.trim().slice(0, 300) || undefined;

    const [recent, favorites] = await Promise.all([
      this.prisma.contentIdea.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 30, select: { title: true } }),
      this.prisma.hook.findMany({ where: { clientId, isFavorite: true }, orderBy: { usedCount: 'desc' }, take: 8, select: { text: true } }),
    ]);
    const brand: BrandContext = { niche: profile.niche, audience: profile.audience, voice: profile.voice, pillars: profile.pillars };
    const ideas = await this.ai.generateIdeas({
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
        clientId,
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

  async setStatus(clientId: string, id: string, status?: string) {
    if (!status || !['NEW', 'SAVED', 'USED', 'DISMISSED'].includes(status)) throw new BadRequestException('Choose a supported status.');
    const idea = await this.prisma.contentIdea.findFirst({ where: { id, clientId }, select: { id: true } });
    if (!idea) throw new NotFoundException('Idea not found.');
    return serializeIdea(await this.prisma.contentIdea.update({ where: { id }, data: { status } }));
  }

  async remove(clientId: string, id: string) {
    await this.prisma.contentIdea.deleteMany({ where: { id, clientId } });
  }

  // ---- autopilot ----

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async autopilot() {
    if (!this.ai.configured) return;
    // Only active clients (not suspended) that have AI and Content Lab switched on. Profiles not yet moved into a client wait for the backfill.
    const profiles = await this.prisma.brandProfile.findMany({ where: { autopilot: true, clientId: { not: null }, client: { status: 'ACTIVE' } }, orderBy: { createdAt: 'asc' } });
    for (const profile of profiles) {
      const clientId = profile.clientId as string;
      const switches = await this.features.forClient(clientId);
      if (!switches.ai || !switches['content-lab']) continue;
      if (profile.lastAutopilotAt && Date.now() - profile.lastAutopilotAt.getTime() < AUTOPILOT_GAP_MS) continue;
      await this.prisma.brandProfile.update({ where: { id: profile.id }, data: { lastAutopilotAt: new Date() } });
      try {
        const ideas = await this.generate(clientId, profile.userId, { count: profile.ideasPerRun, source: 'AUTOPILOT' });
        this.log.log(`Autopilot added ${ideas.length} ideas for client ${clientId}`);
      } catch (error) {
        this.log.error(`Autopilot failed for client ${clientId}: ${error instanceof Error ? error.message : error}`);
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
