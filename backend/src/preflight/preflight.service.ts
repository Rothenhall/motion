import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import { ContentCheck } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ClaudeService, PLATFORMS, PreflightReport, ReviewImage } from '../ai/claude.service';
import { UPLOAD_DIR } from '../media.controller';
import { AudienceSimulation, TribeClient } from './tribe.client';
import { extractFrames, frameTimes, hashFiles, imageForReview, probeVideo, sceneCuts, VideoFacts } from './media-probe';

export type CheckInput = { platform?: string; caption?: string; text?: string; mediaUrls?: unknown; label?: string };
type Kind = 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'TEXT';
type Media = { file: string; path: string; mime: string; url: string };

const MAX_QUEUED_PER_USER = 10;
const MAX_IMAGES = 10;
const MAX_VARIANTS = 3;
// TRIBE cost grows with length; reels are rarely longer than this.
const MAX_SIMULATION_SEC = 180;
const STUCK_AFTER_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const UPLOAD_NAME = /^\d+-[0-9a-f]{8}\.([a-z0-9]+)$/;
const MIME: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

@Injectable()
export class PreflightService {
  private readonly log = new Logger(PreflightService.name);
  private draining = false;

  constructor(private prisma: PrismaService, private claude: ClaudeService, private tribe: TribeClient) {}

  status() {
    return { ai: this.claude.configured, audienceSimulation: this.tribe.configured };
  }

  // ---- create ----

  async create(userId: string, body: CheckInput) {
    const [check] = await this.createMany(userId, [body], null);
    return check;
  }

  async compare(userId: string, body: { platform?: string; caption?: string; variants?: unknown }) {
    if (!Array.isArray(body.variants) || body.variants.length < 2 || body.variants.length > MAX_VARIANTS) {
      throw new BadRequestException(`Add between 2 and ${MAX_VARIANTS} versions to compare.`);
    }
    const variants = body.variants.map((v: any, i: number) => ({
      platform: body.platform,
      caption: typeof v?.caption === 'string' ? v.caption : body.caption,
      text: v?.text,
      mediaUrls: v?.mediaUrls,
      label: v?.label || `Version ${String.fromCharCode(65 + i)}`,
    }));
    const groupId = randomUUID();
    return { groupId, checks: await this.createMany(userId, variants, groupId) };
  }

  private async createMany(userId: string, inputs: CheckInput[], groupId: string | null) {
    if (!this.claude.configured) throw new ServiceUnavailableException('Pre-flight checks need ANTHROPIC_API_KEY in backend/.env.');
    const rows = inputs.map((input) => this.validate(input));
    if (new Set(rows.map((r) => r.kind)).size > 1) throw new BadRequestException('Compare versions of the same kind of post (all videos, all images, or all text).');
    const queued = await this.prisma.contentCheck.count({ where: { userId, status: { in: ['PENDING', 'RUNNING'] } } });
    if (queued + rows.length > MAX_QUEUED_PER_USER) throw new BadRequestException('You have several checks running already. Wait for them to finish first.');
    const created = await this.prisma.$transaction(rows.map((row) => this.prisma.contentCheck.create({ data: { ...row, userId, groupId } })));
    setImmediate(() => void this.drain());
    return created.map(serialize);
  }

  private validate(input: CheckInput) {
    const platform = input.platform || 'instagram';
    if (!(PLATFORMS as readonly string[]).includes(platform)) throw new BadRequestException('Choose a supported platform.');
    const caption = typeof input.caption === 'string' ? input.caption.trim().slice(0, 2200) : '';
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, 5000) : '';
    if (input.mediaUrls !== undefined && (!Array.isArray(input.mediaUrls) || input.mediaUrls.some((u) => typeof u !== 'string'))) {
      throw new BadRequestException('mediaUrls must be a list of uploaded file URLs.');
    }
    const media = ((input.mediaUrls as string[] | undefined) || []).map(resolveUpload);
    const videos = media.filter((m) => m.mime.startsWith('video/'));
    let kind: Kind;
    if (!media.length) {
      if (!text && !caption) throw new BadRequestException('Upload a video or image, or paste the text you plan to post.');
      kind = 'TEXT';
    } else if (videos.length) {
      if (media.length > 1) throw new BadRequestException('Check one video at a time.');
      kind = 'VIDEO';
    } else {
      if (media.length > MAX_IMAGES) throw new BadRequestException(`A carousel can have up to ${MAX_IMAGES} images.`);
      kind = media.length === 1 ? 'IMAGE' : 'CAROUSEL';
    }
    const label = typeof input.label === 'string' ? input.label.trim().slice(0, 60) || null : null;
    return { kind, platform, caption: caption || null, text: text || null, label, mediaUrls: JSON.stringify(media.map((m) => m.url)) };
  }

  // ---- read ----

  async list(userId: string) {
    const checks = await this.prisma.contentCheck.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return checks.map((c) => {
      const { signals, report, ...rest } = serialize(c);
      return { ...rest, verdict: report?.verdict ?? null, hook: report?.hook ?? null };
    });
  }

  async get(userId: string, id: string) {
    const check = await this.prisma.contentCheck.findFirst({ where: { id, userId } });
    if (!check) throw new NotFoundException('Check not found.');
    return serialize(check);
  }

  /** Versions ranked by how well they open. Same-model relative comparisons are the most trustworthy use of the simulation. */
  async group(userId: string, groupId: string) {
    const checks = (await this.prisma.contentCheck.findMany({ where: { userId, groupId }, orderBy: { createdAt: 'asc' } })).map(serialize);
    if (!checks.length) throw new NotFoundException('Comparison not found.');
    const done = checks.every((c) => c.status === 'DONE' || c.status === 'FAILED');
    const scored = checks.filter((c) => c.status === 'DONE');
    const bySimulation = scored.length > 1 && scored.every((c) => c.signals?.simulation?.scores?.hook);
    const rankScore = (c: (typeof checks)[number]) => (bySimulation ? c.signals!.simulation!.scores.hook!.value : c.report?.hook.score ?? -1);
    const ranking = done ? [...scored].sort((a, b) => rankScore(b) - rankScore(a)).map((c) => ({ id: c.id, label: c.label, score: rankScore(c) })) : null;
    return { groupId, done, rankedBy: bySimulation ? 'AUDIENCE_SIMULATION' : 'AI_REVIEW', ranking, checks };
  }

  async remove(userId: string, id: string) {
    await this.prisma.contentCheck.deleteMany({ where: { id, userId } });
  }

  async retry(userId: string, id: string) {
    const { count } = await this.prisma.contentCheck.updateMany({ where: { id, userId, status: 'FAILED' }, data: { status: 'PENDING', error: null, attempts: 0 } });
    if (!count) throw new NotFoundException('No failed check to retry.');
    setImmediate(() => void this.drain());
    return this.get(userId, id);
  }

  // ---- background job ----

  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.recoverStuck();
      for (;;) {
        const next = await this.prisma.contentCheck.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (!next) break;
        const claimed = await this.prisma.contentCheck.updateMany({ where: { id: next.id, status: 'PENDING' }, data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } } });
        if (claimed.count) await this.process(next.id);
      }
    } catch (error) {
      this.log.error(`Pre-flight queue error: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.draining = false;
    }
  }

  /** A restart mid-check leaves rows RUNNING; requeue them once, then give up. */
  private async recoverStuck() {
    const before = new Date(Date.now() - STUCK_AFTER_MS);
    await this.prisma.contentCheck.updateMany({ where: { status: 'RUNNING', startedAt: { lt: before }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: 'PENDING' } });
    await this.prisma.contentCheck.updateMany({ where: { status: 'RUNNING', startedAt: { lt: before } }, data: { status: 'FAILED', error: 'This check took too long. Try again.' } });
  }

  async process(id: string) {
    const check = await this.prisma.contentCheck.findUnique({ where: { id } });
    if (!check) return;
    try {
      const media = parseJson<string[]>(check.mediaUrls, []).map(resolveUpload);
      const mediaHash = media.length ? await hashFiles(media.map((m) => m.path)) : null;
      const signals: Record<string, any> = {};
      const images: ReviewImage[] = [];
      let simulation: AudienceSimulation | null = null;

      if (check.kind === 'VIDEO') {
        const video = media[0];
        const facts = await probeVideo(video.path);
        const cuts = await sceneCuts(video.path).catch(() => []);
        const frames = await extractFrames(video.path, frameTimes(facts.durationSec));
        frames.forEach((f) => images.push({ label: `Frame at ${f.atSec.toFixed(1)}s`, mediaType: 'image/jpeg', data: f.jpegBase64 }));
        signals.video = { ...facts, cuts, frameTimes: frames.map((f) => f.atSec) };
        if (this.tribe.configured) {
          if (facts.durationSec > MAX_SIMULATION_SEC) signals.simulationError = 'Audience simulation runs on videos up to 3 minutes.';
          else {
            try { simulation = await this.tribe.analyze(video.path, { soundOff: facts.hasAudio }); }
            catch (error) { signals.simulationError = error instanceof Error ? error.message : 'The audience simulation failed.'; }
          }
        }
        if (simulation) signals.simulation = simulation;
      } else if (check.kind !== 'TEXT') {
        for (const [i, m] of media.entries()) {
          const image = await imageForReview(m.path, m.mime);
          images.push({ label: check.kind === 'CAROUSEL' ? `Slide ${i + 1}` : 'The image', ...image });
        }
      }

      const [brand, history] = await Promise.all([this.brand(check.userId), this.history(check.userId)]);
      const report = await this.claude.reviewContent({
        kind: check.kind as Kind,
        platform: check.platform,
        caption: check.caption,
        text: check.text,
        brand,
        facts: reviewFacts(check.kind as Kind, signals.video, check.caption, check.text, media.length),
        simulation: simulation ? simulationForReview(simulation) : null,
        history,
        images,
      });

      await this.prisma.contentCheck.update({
        where: { id },
        data: {
          status: 'DONE',
          engine: simulation ? 'AUDIENCE_SIMULATION' : 'AI_REVIEW',
          mediaHash,
          signals: JSON.stringify(signals),
          report: JSON.stringify(report),
          error: null,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The check failed.';
      this.log.warn(`Pre-flight check ${id} failed: ${message}`);
      await this.prisma.contentCheck.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 500), completedAt: new Date() } });
    }
  }

  private async brand(userId: string) {
    const profile = await this.prisma.brandProfile.findUnique({ where: { userId } });
    return profile ? { niche: profile.niche, audience: profile.audience, voice: profile.voice, pillars: parseJson<string[]>(profile.pillars, []) } : null;
  }

  /** The creator's own best and worst recent posts, so advice can lean on what works for this audience. */
  private async history(userId: string): Promise<string | null> {
    const rows = await this.prisma.postInsight.findMany({
      where: { account: { userId }, views: { not: null } },
      orderBy: { fetchedAt: 'desc' },
      take: 60,
      select: { views: true, likes: true, shares: true, saves: true, post: { select: { mediaType: true, caption: true, platform: true } } },
    });
    if (rows.length < 5) return null;
    const sorted = [...rows].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    const median = sorted[Math.floor(sorted.length / 2)].views ?? 0;
    const line = (r: (typeof rows)[number]) => `- ${r.post.mediaType} on ${r.post.platform}: ${r.views} views, ${r.likes ?? '?'} likes, ${r.shares ?? '?'} shares, ${r.saves ?? '?'} saves. Caption starts: "${(r.post.caption || '').slice(0, 90)}"`;
    return [`Median views over the last ${rows.length} posts: ${median}.`, 'Best:', ...sorted.slice(0, 3).map(line), 'Weakest:', ...sorted.slice(-3).map(line)].join('\n');
  }
}

/** Only files Motion's own uploader created, resolved inside the upload folder. */
function resolveUpload(url: string): Media {
  let file = '';
  try { file = new URL(url).pathname.replace(/^\/media\//, ''); } catch { /* invalid URL */ }
  const match = UPLOAD_NAME.exec(file);
  const mime = match ? MIME[match[1]] : undefined;
  const path = join(UPLOAD_DIR, file);
  if (!match || !mime || !existsSync(path)) throw new BadRequestException('Upload the file with Motion first, then check it.');
  return { file, path, mime, url };
}

function reviewFacts(kind: Kind, video: (VideoFacts & { cuts: number[] }) | undefined, caption: string | null, text: string | null, count: number) {
  const facts: Record<string, unknown> = { captionLength: caption?.length ?? 0 };
  if (kind === 'CAROUSEL') facts.slides = count;
  if (kind === 'TEXT') facts.textLength = text?.length ?? 0;
  if (video) {
    facts.durationSec = Math.round(video.durationSec * 10) / 10;
    facts.vertical = video.width && video.height ? video.height > video.width : null;
    facts.hasSoundtrack = video.hasAudio;
    facts.cuts = video.cuts.length;
    facts.firstCutSec = video.cuts[0] ?? null;
    facts.cutTimesSec = video.cuts.slice(0, 40);
  }
  return facts;
}

/** The part of the simulation Claude needs: scores, moments, the attention curve and a timed transcript. */
function simulationForReview(sim: AudienceSimulation) {
  const scores = Object.fromEntries(Object.entries(sim.scores).map(([k, v]) => [k, v ? { value: v.value, percentile: v.percentile } : null]));
  const transcript: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  for (const w of sim.transcript || []) {
    if (!line.length) lineStart = w.start;
    line.push(w.word);
    if (line.length >= 10) { transcript.push(`[${lineStart.toFixed(1)}s] ${line.join(' ')}`); line = []; }
  }
  if (line.length) transcript.push(`[${lineStart.toFixed(1)}s] ${line.join(' ')}`);
  return {
    baseline: sim.baseline,
    referenceLibrary: sim.reference_label,
    seconds: sim.seconds,
    scores,
    facts: sim.facts,
    moments: sim.moments,
    attentionBySecond: sim.curves.attention_index,
    attentionMutedBySecond: sim.sound_off_attention,
    facesBySecond: sim.curves.faces,
    transcript: transcript.join('\n') || null,
  };
}

type Signals = { video?: VideoFacts & { cuts: number[]; frameTimes: number[] }; simulation?: AudienceSimulation; simulationError?: string };

function serialize(check: ContentCheck) {
  const { mediaHash, attempts, ...rest } = check;
  const signals = parseJson<Signals | null>(check.signals, null);
  if (signals?.simulation) delete (signals.simulation as Partial<AudienceSimulation>).transcript;
  return {
    ...rest,
    mediaUrls: parseJson<string[]>(check.mediaUrls, []),
    signals,
    report: parseJson<PreflightReport | null>(check.report, null),
  };
}
