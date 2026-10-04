import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
const TIMEOUT_MS = 5 * 60 * 1000;

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export const PLATFORMS = ['instagram', 'facebook', 'threads'] as const;
export const IDEA_FORMATS = ['REEL', 'CAROUSEL', 'IMAGE', 'THREAD', 'TEXT', 'STORY'] as const;
export const HOOK_CATEGORIES = ['CURIOSITY', 'CONTRARIAN', 'STORY', 'LISTICLE', 'QUESTION', 'PROOF', 'PAIN', 'HOW_TO'] as const;

export type BrandContext = { niche: string; audience?: string | null; voice?: string | null; pillars: string[] };

const IdeaSchema = z.object({
  ideas: z.array(z.object({
    title: z.string().describe('Short internal name for the post, under 70 characters'),
    hook: z.string().describe('The literal opening line or on-screen text, written to stop the scroll'),
    angle: z.string().describe('One sentence on the take and why it should land with this audience'),
    format: z.enum(IDEA_FORMATS),
    platform: z.enum(PLATFORMS),
    pillar: z.string().describe('Which content pillar this belongs to, or a short theme if none fit'),
    caption: z.string().describe('A ready-to-post caption draft in the brand voice, including a call to action'),
    hashtags: z.array(z.string()).describe('3 to 8 hashtags without the # sign'),
  })),
});

const HookSchema = z.object({
  hooks: z.array(z.object({
    text: z.string().describe('The hook, one or two short sentences'),
    category: z.enum(HOOK_CATEGORIES),
  })),
});

export const RATINGS = ['WEAK', 'OK', 'STRONG'] as const;
export const DIMENSIONS = ['HOOK', 'CLARITY', 'VISUALS', 'PACING', 'EMOTION', 'SOUND_OFF', 'CTA'] as const;
export const INSIGHT_BASES = ['AUDIENCE_SIMULATION', 'VISUAL_REVIEW', 'COPY_REVIEW', 'YOUR_HISTORY'] as const;

const PreflightSchema = z.object({
  verdict: z.string().describe('One plain sentence for the creator: the most important thing about how people will likely react'),
  hook: z.object({
    rating: z.enum(RATINGS),
    score: z.number().describe('0 to 100: how likely the opening (first 3 seconds, or first line) is to stop the scroll'),
    reason: z.string().describe('One sentence on why'),
  }),
  dimensions: z.array(z.object({
    key: z.enum(DIMENSIONS),
    rating: z.enum(RATINGS),
    note: z.string().describe('A few words on why'),
  })),
  insights: z.array(z.object({
    title: z.string().describe('Short headline in plain words, e.g. "Slow opening"'),
    detail: z.string().describe('What viewers will likely do and why, one or two sentences, hedged ("may", "likely")'),
    fix: z.string().describe('A concrete edit the creator can make before posting'),
    severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    startSec: z.number().nullable().describe('Seconds from the start of the video, or null'),
    endSec: z.number().nullable(),
    basis: z.enum(INSIGHT_BASES),
  })),
  alternativeHooks: z.array(z.string()).describe('Three stronger openings written for this exact post'),
});

export type PreflightReport = z.infer<typeof PreflightSchema>;
export type ReviewImage = { label: string; mediaType: string; data: string };
export type PreflightInput = {
  kind: 'VIDEO' | 'IMAGE' | 'CAROUSEL' | 'TEXT';
  platform: string;
  caption?: string | null;
  text?: string | null;
  brand?: BrandContext | null;
  facts: Record<string, unknown>;
  simulation?: Record<string, unknown> | null;
  history?: string | null;
  images: ReviewImage[];
};

export type GeneratedIdea = z.infer<typeof IdeaSchema>['ideas'][number];
export type GeneratedHook = z.infer<typeof HookSchema>['hooks'][number];

const SYSTEM = `You are the content strategist inside Motion, a social media marketing tool for creators and small brands on Instagram, Facebook and Threads.
Write in the brand's own voice. Be specific to the niche: concrete examples, numbers, named situations the audience recognises. Avoid generic advice, clichés like "game-changer" or "unlock", and emoji spam.
Match each idea to how the platform actually works: Reels and Stories are visual and fast, carousels teach step by step, Threads rewards conversational text, Facebook favours community and longer captions.`;

const PREFLIGHT_SYSTEM = `You are Motion's pre-flight reviewer. A creator is about to post something on social media. Predict how people scrolling their feed will likely react, and tell the creator exactly what to change before posting.

Rules:
- Talk to the creator as "you", in plain words. Be specific to this post: point at a timestamp, a frame, or a line of the caption.
- Never mention brains, neurons, fMRI, cortex, brain regions, "neuro" or the simulation's internals. Say "viewers" and "attention".
- These are estimates. Use "may", "likely", "compared with similar posts". Never promise results.
- Every insight needs a concrete fix the creator can make in their editor or caption.
- Give 3 to 6 insights, most important first. Include one thing that already works (severity LOW, framed as "keep this").
- Timestamps are seconds from the start of the video; use null for images, text, or whole-post points.

When an audience simulation is provided, it is a model's estimate of how an average viewer's attention moves second by second (0-100, 50 = typical).
- Use it to find where attention may rise or dip, then use the frames at those times to explain why. If the frames don't back it up, say less.
- Each flagged moment lists what viewers are likely doing more or less of there ("becauseViewersAre"), and responsesBySecond has those responses for every second. Combine them with the frame at that time and the transcript line being spoken to name the cause in creator terms (e.g. "nothing moves for 3 seconds while you explain", "three lines of text appear at once", "your face leaves the frame"), then give the edit that fixes that cause.
- Give every attention dip and every text-overload moment its own insight with its startSec and endSec, unless two overlap. Use the strongest moment of attention for the "keep this" insight when the frames back it up.
- Compare the muted attention with the full attention: where they split, the point depends on sound; suggest on-screen text or captions for exactly those seconds.
- baseline "library" means scores compare this video with a library of similar reels; you may say "lower than most similar reels". baseline "clip" means the scores only compare parts of this video with each other: say "weaker than the rest of your video", never compare with other creators.
- Unless the baseline is "library" or the creator's history is given, never claim a comparison with other posts ("most similar reels", "most reels", "average reel") anywhere in the report, including the hook reason.
- sound_off_resilience estimates how well the video works muted (how most feeds autoplay). A low value means the point is lost without sound.
- Do not quote raw scores. Do not invent numbers.
- Mark insights driven mainly by it as AUDIENCE_SIMULATION, by the frames as VISUAL_REVIEW, by the caption or script as COPY_REVIEW, by the creator's past performance as YOUR_HISTORY.

Alternative hooks: three openings for this exact post in the brand's voice. For video, the first spoken line or on-screen text; for images and text, the first line of the caption or post.`;

/** Calls a model on OpenRouter and returns schema-validated JSON for the AI features. */
@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  readonly model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  get configured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  async generateIdeas(input: { brand: BrandContext; platforms: string[]; count: number; topic?: string; avoid: string[]; favoriteHooks: string[] }) {
    const lines = [
      brandBlock(input.brand),
      `Platforms to plan for: ${input.platforms.join(', ')}.`,
      input.topic ? `Focus this batch on: ${input.topic}` : 'Spread the batch across the content pillars.',
      input.favoriteHooks.length ? `Hooks this brand likes, as a style reference (do not copy them):\n${input.favoriteHooks.map((h) => `- ${h}`).join('\n')}` : '',
      input.avoid.length ? `Recent ideas already on the list, so do not repeat them:\n${input.avoid.map((t) => `- ${t}`).join('\n')}` : '',
      `Give exactly ${input.count} distinct post ideas, mixing formats.`,
    ];
    const out = await this.parse(lines.filter(Boolean).join('\n\n'), IdeaSchema, 'post_ideas');
    return out.ideas.slice(0, input.count);
  }

  async generateHooks(input: { brand?: BrandContext | null; topic: string; platform?: string; count: number; category?: string }) {
    const lines = [
      input.brand ? brandBlock(input.brand) : '',
      `Write ${input.count} scroll-stopping opening hooks for a post about: ${input.topic}`,
      input.platform ? `They will open a ${input.platform} post.` : '',
      input.category ? `Every hook must be in the ${input.category} category.` : `Spread them across these categories: ${HOOK_CATEGORIES.join(', ')}.`,
      'Each hook stands on its own and makes the reader need the next line. No hashtags, no emoji.',
    ];
    const out = await this.parse(lines.filter(Boolean).join('\n\n'), HookSchema, 'hooks');
    return out.hooks.slice(0, input.count);
  }

  /** Pre-flight check: frames / images + measured facts + optional audience simulation -> plain-language insights. */
  async reviewContent(input: PreflightInput): Promise<PreflightReport> {
    const dimensions = input.kind === 'VIDEO' ? DIMENSIONS : input.kind === 'TEXT' ? ['HOOK', 'CLARITY', 'EMOTION', 'CTA'] : ['HOOK', 'VISUALS', 'CLARITY', 'EMOTION', 'CTA'];
    const kindLabel = { VIDEO: 'a reel / short video', IMAGE: 'a single image post', CAROUSEL: 'a carousel', TEXT: 'a text post' }[input.kind];
    const lines = [
      `The creator is about to post ${kindLabel} on ${input.platform}.`,
      input.brand ? brandBlock(input.brand) : '',
      input.caption ? `Caption:\n"""${input.caption}"""` : 'No caption yet.',
      input.text ? (input.kind === 'TEXT' ? `Post text:\n"""${input.text}"""` : `Script / voiceover / on-screen text the creator provided:\n"""${input.text}"""`) : '',
      `Measured facts: ${JSON.stringify(input.facts)}`,
      input.simulation ? `Audience simulation: ${JSON.stringify(input.simulation)}` : input.kind === 'VIDEO' ? 'No audience simulation is available for this video: base the review on the frames, facts and copy.' : '',
      input.history ? `How this creator's recent posts performed:\n${input.history}` : '',
      `Rate exactly these dimensions: ${dimensions.join(', ')}.`,
      input.images.length ? (input.kind === 'VIDEO' ? 'Frames from the video follow, each labelled with its timestamp.' : 'The images follow, in posting order.') : '',
    ];
    const content: ContentPart[] = [{ type: 'text', text: lines.filter(Boolean).join('\n\n') }];
    for (const image of input.images) {
      content.push({ type: 'text', text: image.label });
      content.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } });
    }
    const report = await this.parse(content, PreflightSchema, 'preflight_report', PREFLIGHT_SYSTEM);
    return {
      ...report,
      hook: { ...report.hook, score: Math.max(0, Math.min(100, Math.round(report.hook.score))) },
      dimensions: report.dimensions.filter((d) => (dimensions as readonly string[]).includes(d.key)),
      insights: report.insights.slice(0, 6),
      alternativeHooks: report.alternativeHooks.slice(0, 3),
    };
  }

  /** One chat completion with a strict JSON schema, validated with zod. Retries once when the model returns invalid JSON. */
  private async parse<T>(prompt: string | ContentPart[], schema: z.ZodType<T>, name: string, system = SYSTEM): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('AI features need OPENROUTER_API_KEY in backend/.env.');
    const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
    // Some models drop response_format when images are attached, so the schema is also spelled out in the prompt.
    const format = `Reply with only a JSON object, no markdown or commentary, that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    const messages: Record<string, unknown>[] = [{ role: 'system', content: `${system}\n\n${format}` }, { role: 'user', content: prompt }];
    for (let attempt = 1; ; attempt++) {
      const text = await this.complete({
        model: this.model,
        max_tokens: 16000,
        messages,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: jsonSchema } },
        // Only route to providers that honour the JSON schema.
        provider: { require_parameters: true },
      });
      const json = parseJson(text);
      const parsed = schema.safeParse(json);
      if (parsed.success) return parsed.data;
      const why = json === undefined ? `not JSON, starts: ${JSON.stringify(text.slice(0, 200))}` : parsed.error.message.slice(0, 300);
      this.log.warn(`AI reply does not match ${name} (attempt ${attempt}): ${why}`);
      if (attempt >= 2) throw new BadGatewayException('The AI returned an unexpected response. Try again.');
      // Keep the work from the first reply and ask only for the conversion.
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That reply was not valid JSON for the schema. Rewrite the same content as only the JSON object. ${format}` });
    }
  }

  private async complete(body: Record<string, unknown>): Promise<string> {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Motion' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.log.error(`OpenRouter request failed: ${error instanceof Error ? error.message : error}`);
      throw new BadGatewayException('The AI request failed. Try again.');
    }
    const data: any = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) throw new ServiceUnavailableException('OPENROUTER_API_KEY was rejected. Check backend/.env.');
    if (res.status === 402) throw new ServiceUnavailableException('The OpenRouter account is out of credits.');
    if (res.status === 429) throw new ServiceUnavailableException('The AI is busy right now. Try again in a minute.');
    if (!res.ok || data?.error) {
      const meta = data?.error?.metadata;
      this.log.error(`OpenRouter error ${res.status}: ${data?.error?.message ?? 'no details'}${meta ? ` (${meta.provider_name ?? 'provider'}: ${String(meta.raw ?? '').slice(0, 300)})` : ''}`);
      throw new BadGatewayException('The AI request failed. Try again.');
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new BadGatewayException('The AI response was cut off. Ask for fewer items.');
    if (choice?.message?.refusal) throw new BadGatewayException('The AI declined this request. Try rephrasing the topic.');
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new BadGatewayException('The AI returned an empty response. Try again.');
    return content;
  }
}

/** JSON from a model reply, tolerating a ```json fence or stray text around the object. */
export function parseJson(text: string): unknown {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(unfenced); } catch { /* fall through */ }
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { return undefined; }
}

function brandBlock(brand: BrandContext) {
  return [
    `Brand niche: ${brand.niche}`,
    brand.audience ? `Audience: ${brand.audience}` : '',
    brand.voice ? `Voice: ${brand.voice}` : '',
    brand.pillars.length ? `Content pillars: ${brand.pillars.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}
