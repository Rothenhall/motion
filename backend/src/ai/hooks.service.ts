import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ClaudeService, HOOK_CATEGORIES, PLATFORMS } from './claude.service';
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
export class HooksService implements OnModuleInit {
  constructor(private prisma: PrismaService, private claude: ClaudeService, private ideas: IdeasService) {}

  /** Fill the starter library on first boot. */
  async onModuleInit() {
    const seeded = await this.prisma.hook.count({ where: { source: 'SEED' } });
    if (seeded) return;
    await this.prisma.hook.createMany({ data: HOOK_SEEDS.map((h) => ({ text: h.text, category: h.category, platform: h.platform ?? null, source: 'SEED' })) });
  }

  list(filter: { category?: string; platform?: string; q?: string; favorites?: boolean; source?: string }) {
    const where: Prisma.HookWhereInput = {};
    if (filter.category) where.category = filter.category;
    if (filter.platform) where.OR = [{ platform: filter.platform }, { platform: null }];
    if (filter.q) where.text = { contains: filter.q.trim() };
    if (filter.favorites) where.isFavorite = true;
    if (filter.source) where.source = filter.source;
    return this.prisma.hook.findMany({ where, orderBy: [{ isFavorite: 'desc' }, { usedCount: 'desc' }, { createdAt: 'desc' }], take: 300 });
  }

  create(body: { text?: string; category?: string; platform?: string }) {
    const text = body.text?.trim();
    if (!text) throw new BadRequestException('Write the hook first.');
    if (text.length > 280) throw new BadRequestException('Keep hooks under 280 characters.');
    const category = body.category || 'CURIOSITY';
    checkCategory(category);
    checkPlatform(body.platform || undefined);
    return this.prisma.hook.create({ data: { text, category, platform: body.platform || null, source: 'CUSTOM' } });
  }

  async generate(body: { topic?: string; platform?: string; count?: number; category?: string }) {
    const topic = body.topic?.trim().slice(0, 300);
    if (!topic) throw new BadRequestException('Tell Motion what the post is about.');
    const count = body.count ?? 6;
    if (!Number.isInteger(count) || count < 1 || count > MAX_HOOKS) throw new BadRequestException(`Ask for between 1 and ${MAX_HOOKS} hooks.`);
    checkCategory(body.category || undefined);
    checkPlatform(body.platform || undefined);
    const profile = await this.ideas.getProfile();
    const hooks = await this.claude.generateHooks({
      brand: profile && { niche: profile.niche, audience: profile.audience, voice: profile.voice, pillars: profile.pillars },
      topic,
      platform: body.platform || undefined,
      count,
      category: body.category || undefined,
    });
    return this.prisma.$transaction(hooks.map((h) => this.prisma.hook.create({
      data: { text: h.text.trim(), category: h.category, platform: body.platform || null, source: 'AI', topic },
    })));
  }

  async toggleFavorite(id: string) {
    const hook = await this.find(id);
    return this.prisma.hook.update({ where: { id }, data: { isFavorite: !hook.isFavorite } });
  }

  async markUsed(id: string) {
    await this.find(id);
    return this.prisma.hook.update({ where: { id }, data: { usedCount: { increment: 1 } } });
  }

  async remove(id: string) {
    await this.prisma.hook.deleteMany({ where: { id } });
  }

  private async find(id: string) {
    const hook = await this.prisma.hook.findUnique({ where: { id } });
    if (!hook) throw new NotFoundException('Hook not found.');
    return hook;
  }
}
