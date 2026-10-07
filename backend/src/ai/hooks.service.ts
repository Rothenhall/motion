import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AiService, HOOK_CATEGORIES, PLATFORMS } from './ai.service';
import { HOOK_SEEDS } from './hook-seeds';
import { IdeasService } from './ideas.service';

const MAX_HOOKS = 12;

function checkCategory(category?: string) {
  if (category && !(HOOK_CATEGORIES as readonly string[]).includes(category)) throw new BadRequestException('Choose a supported hook category.');
}

function checkPlatform(platform?: string) {
  if (platform && !(PLATFORMS as readonly string[]).includes(platform)) throw new BadRequestException('Choose a supported platform.');
}

@Injectable()
export class HooksService {
  constructor(private prisma: PrismaService, private ai: AiService, private ideas: IdeasService) {}

  /** Gives a client their own copy of the starter library the first time they open it. */
  private async ensureSeeded(clientId: string, userId: string) {
    if (await this.prisma.hook.count({ where: { clientId, source: 'SEED' } })) return;
    await this.prisma.$transaction(async (tx) => {
      // Serialize per client so two first loads at once don't seed twice.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clientId}))`;
      if (await tx.hook.count({ where: { clientId, source: 'SEED' } })) return;
      await tx.hook.createMany({ data: HOOK_SEEDS.map((h) => ({ userId, clientId, text: h.text, category: h.category, platform: h.platform ?? null, source: 'SEED' })) });
    });
  }

  async list(clientId: string, userId: string, filter: { category?: string; platform?: string; q?: string; favorites?: boolean; source?: string }) {
    await this.ensureSeeded(clientId, userId);
    const where: Prisma.HookWhereInput = { clientId };
    if (filter.category) where.category = filter.category;
    if (filter.platform) where.OR = [{ platform: filter.platform }, { platform: null }];
    if (filter.q) where.text = { contains: filter.q.trim(), mode: 'insensitive' };
    if (filter.favorites) where.isFavorite = true;
    if (filter.source) where.source = filter.source;
    return this.prisma.hook.findMany({ where, orderBy: [{ isFavorite: 'desc' }, { usedCount: 'desc' }, { createdAt: 'desc' }], take: 300 });
  }

  create(clientId: string, userId: string, body: { text?: string; category?: string; platform?: string }) {
    const text = body.text?.trim();
    if (!text) throw new BadRequestException('Write the hook first.');
    if (text.length > 280) throw new BadRequestException('Keep hooks under 280 characters.');
    const category = body.category || 'CURIOSITY';
    checkCategory(category);
    checkPlatform(body.platform || undefined);
    return this.prisma.hook.create({ data: { userId, clientId, text, category, platform: body.platform || null, source: 'CUSTOM' } });
  }

  async generate(clientId: string, userId: string, body: { topic?: string; platform?: string; count?: number; category?: string }) {
    const topic = body.topic?.trim().slice(0, 300);
    if (!topic) throw new BadRequestException('Tell Motion what the post is about.');
    const count = body.count ?? 6;
    if (!Number.isInteger(count) || count < 1 || count > MAX_HOOKS) throw new BadRequestException(`Ask for between 1 and ${MAX_HOOKS} hooks.`);
    checkCategory(body.category || undefined);
    checkPlatform(body.platform || undefined);
    const profile = await this.ideas.getProfile(clientId);
    const hooks = await this.ai.generateHooks({
      brand: profile && { niche: profile.niche, audience: profile.audience, voice: profile.voice, pillars: profile.pillars },
      topic,
      platform: body.platform || undefined,
      count,
      category: body.category || undefined,
    });
    return this.prisma.$transaction(hooks.map((h) => this.prisma.hook.create({
      data: { userId, clientId, text: h.text.trim(), category: h.category, platform: body.platform || null, source: 'AI', topic },
    })));
  }

  async toggleFavorite(clientId: string, id: string) {
    const hook = await this.find(clientId, id);
    return this.prisma.hook.update({ where: { id }, data: { isFavorite: !hook.isFavorite } });
  }

  async markUsed(clientId: string, id: string) {
    await this.find(clientId, id);
    return this.prisma.hook.update({ where: { id }, data: { usedCount: { increment: 1 } } });
  }

  async remove(clientId: string, id: string) {
    await this.prisma.hook.deleteMany({ where: { id, clientId } });
  }

  private async find(clientId: string, id: string) {
    const hook = await this.prisma.hook.findFirst({ where: { id, clientId } });
    if (!hook) throw new NotFoundException('Hook not found.');
    return hook;
  }
}
