import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

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

export type GeneratedIdea = z.infer<typeof IdeaSchema>['ideas'][number];
export type GeneratedHook = z.infer<typeof HookSchema>['hooks'][number];

const SYSTEM = `You are the content strategist inside Motion, a social media marketing tool for creators and small brands on Instagram, Facebook and Threads.
Write in the brand's own voice. Be specific to the niche: concrete examples, numbers, named situations the audience recognises. Avoid generic advice, clichés like "game-changer" or "unlock", and emoji spam.
Match each idea to how the platform actually works: Reels and Stories are visual and fast, carousels teach step by step, Threads rewards conversational text, Facebook favours community and longer captions.`;

/** Thin wrapper around the Anthropic SDK that returns schema-validated JSON for the AI features. */
@Injectable()
export class ClaudeService {
  private readonly log = new Logger(ClaudeService.name);
  private client: Anthropic | null = null;
  readonly model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';

  get configured() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  }

  private sdk() {
    if (!this.configured) throw new ServiceUnavailableException('AI features need ANTHROPIC_API_KEY in backend/.env.');
    this.client ??= new Anthropic();
    return this.client;
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
    const out = await this.parse(lines.filter(Boolean).join('\n\n'), betaZodOutputFormat(IdeaSchema));
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
    const out = await this.parse(lines.filter(Boolean).join('\n\n'), betaZodOutputFormat(HookSchema));
    return out.hooks.slice(0, input.count);
  }

  private async parse<T>(prompt: string, format: ReturnType<typeof betaZodOutputFormat<z.ZodType<T>>>): Promise<T> {
    try {
      const response = await this.sdk().beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format },
        // On a safety decline, let the API retry on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') throw new BadGatewayException('The AI declined this request. Try rephrasing the topic.');
      if (response.stop_reason === 'max_tokens') throw new BadGatewayException('The AI response was cut off. Ask for fewer items.');
      if (!response.parsed_output) throw new BadGatewayException('The AI returned an unexpected response. Try again.');
      return response.parsed_output as T;
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Anthropic.AuthenticationError) throw new ServiceUnavailableException('ANTHROPIC_API_KEY was rejected. Check backend/.env.');
      if (error instanceof Anthropic.RateLimitError) throw new ServiceUnavailableException('The AI is busy right now. Try again in a minute.');
      if (error instanceof Anthropic.APIError) {
        this.log.error(`Claude API error ${error.status}: ${error.message}`);
        throw new BadGatewayException('The AI request failed. Try again.');
      }
      throw error;
    }
  }
}

function brandBlock(brand: BrandContext) {
  return [
    `Brand niche: ${brand.niche}`,
    brand.audience ? `Audience: ${brand.audience}` : '',
    brand.voice ? `Voice: ${brand.voice}` : '',
    brand.pillars.length ? `Content pillars: ${brand.pillars.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}
