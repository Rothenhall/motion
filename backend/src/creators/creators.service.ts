import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { AiService } from '../ai/ai.service';
import { decryptToken } from '../auth/crypto';
import { graphVersion } from '../meta-config';
import { PrismaService } from '../prisma.service';
import {
  ChatMessage,
  CreatorChatReply,
  CreatorCriteria,
  CreatorResult,
  CREATOR_AGE_BUCKETS,
  CREATOR_GENDERS,
  CREATOR_INTERESTS,
  FOLLOWER_BUCKETS,
  RECOMMENDATION_TYPES,
  SAMPLE_CREATORS,
} from './creators.constants';

const MAX_RESULTS = 5;
const SEARCH_FIELDS = 'id,username,profile_picture_url,biography,country,gender,age_bucket,is_account_verified,onboarded_status,email,portfolio_url,has_brand_partnership_experience';

/** Loose matches the chat AI may return, mapped to Discovery API values. Unknowns are dropped. */
const INTEREST_ALIASES: Record<string, string> = {
  FITNESS: 'FITNESS_AND_WORKOUTS', WORKOUT: 'FITNESS_AND_WORKOUTS', GYM: 'FITNESS_AND_WORKOUTS', HEALTH: 'FITNESS_AND_WORKOUTS',
  FOOD: 'FOOD_AND_DRINK', COOKING: 'FOOD_AND_DRINK', BAKING: 'FOOD_AND_DRINK', RECIPE: 'FOOD_AND_DRINK',
  TRAVEL: 'TRAVEL_AND_LEISURE_ACTIVITIES', FASHION: 'FASHION', STYLE: 'FASHION', BEAUTY: 'BEAUTY', SKINCARE: 'BEAUTY',
  MUSIC: 'MUSIC_AND_AUDIO', SPORTS: 'SPORTS', BUSINESS: 'BUSINESS_FINANCE_AND_ECONOMICS', FINANCE: 'BUSINESS_FINANCE_AND_ECONOMICS',
  EDUCATION: 'EDUCATION_AND_LEARNING', TECH: 'SCIENCE_AND_TECH', TECHNOLOGY: 'SCIENCE_AND_TECH', GAMING: 'GAMES_PUZZLES_AND_PLAY',
  GAMES: 'GAMES_PUZZLES_AND_PLAY', PETS: 'ANIMALS_AND_PETS', ANIMALS: 'ANIMALS_AND_PETS', BOOKS: 'BOOKS_AND_LITERATURE',
  MOVIES: 'TV_AND_MOVIES', TV: 'TV_AND_MOVIES', ART: 'VISUAL_ARTS_ARCHITECTURE_AND_CRAFTS',
};

function snapBucket(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  let best: number = FOLLOWER_BUCKETS[0];
  for (const b of FOLLOWER_BUCKETS) {
    if (Math.abs(b - value) < Math.abs(best - value)) best = b;
  }
  return best;
}

/**
 * Sanitizes chat or form input into valid Discovery API criteria. The chat model
 * invents values ("any", lowercase interests, off-list numbers), so unknowns are
 * dropped and numbers snap to the nearest bucket instead of failing the request.
 */
function cleanCriteria(input: Partial<CreatorCriteria>): CreatorCriteria {
  const countries = (input.creatorCountries ?? []).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 10);
  const audience = (input.majorAudienceCountries ?? []).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 10);
  const interests = [...new Set(
    (input.creatorInterests ?? [])
      .map((i) => i.trim().toUpperCase().replace(/[\s-]+/g, '_'))
      .map((i) => (CREATOR_INTERESTS as readonly string[]).includes(i) ? i : INTEREST_ALIASES[i])
      .filter(Boolean),
  )].slice(0, 5) as string[];
  let min = snapBucket(input.creatorMinFollowers);
  let max = snapBucket(input.creatorMaxFollowers);
  if (min !== undefined && max !== undefined && min > max) max = undefined;
  const gender = (CREATOR_GENDERS as readonly string[]).includes(input.creatorGender ?? '') ? input.creatorGender : undefined;
  const ageBucket = (CREATOR_AGE_BUCKETS as readonly string[]).includes(input.creatorAgeBucket ?? '') ? input.creatorAgeBucket : undefined;
  const recommendationType = (RECOMMENDATION_TYPES as readonly string[]).includes(input.recommendationType ?? '') ? input.recommendationType : undefined;
  const similarTo = [...new Set((input.similarTo ?? []).map((u) => u.trim().replace(/^@/, '')).filter(Boolean))].slice(0, 5);
  return {
    query: input.query?.trim().slice(0, 200) || undefined,
    creatorCountries: countries,
    creatorMinFollowers: min,
    creatorMaxFollowers: max,
    creatorInterests: interests,
    creatorGender: gender,
    creatorAgeBucket: ageBucket,
    majorAudienceCountries: audience,
    recommendationType,
    similarTo,
  };
}

function toParams(criteria: CreatorCriteria, limit: number): Record<string, string> {
  const params: Record<string, string> = { fields: SEARCH_FIELDS, limit: String(limit) };
  if (criteria.query) params.query = criteria.query;
  if (criteria.creatorCountries.length) params.creator_countries = JSON.stringify(criteria.creatorCountries);
  if (criteria.creatorMinFollowers !== undefined) params.creator_min_followers = String(criteria.creatorMinFollowers);
  if (criteria.creatorMaxFollowers !== undefined) params.creator_max_followers = String(criteria.creatorMaxFollowers);
  if (criteria.creatorInterests.length) params.creator_interests = JSON.stringify(criteria.creatorInterests);
  if (criteria.creatorGender) params.creator_gender = criteria.creatorGender;
  if (criteria.creatorAgeBucket) params.creator_age_bucket = criteria.creatorAgeBucket;
  if (criteria.majorAudienceCountries.length) params.major_audience_countries = JSON.stringify(criteria.majorAudienceCountries);
  if (criteria.recommendationType) params.recommendation_type = criteria.recommendationType;
  if (criteria.similarTo.length) params.similar_to_creators = JSON.stringify(criteria.similarTo);
  return params;
}

function normalize(item: any): CreatorResult {
  const insights = item?.insights?.data ?? item?.insights ?? [];
  const engaged = Array.isArray(insights)
    ? insights.find((m: any) => m?.name === 'creator_engaged_accounts')?.values?.[0]?.value
    : undefined;
  return {
    id: item?.id ? String(item.id) : undefined,
    username: String(item?.username ?? ''),
    profile_picture_url: item?.profile_picture_url ?? undefined,
    biography: item?.biography ?? undefined,
    country: item?.country ?? undefined,
    gender: item?.gender ?? undefined,
    followers: typeof engaged === 'number' ? engaged : undefined,
    is_account_verified: item?.is_account_verified ?? undefined,
    onboarded_status: item?.onboarded_status ?? undefined,
    email: item?.email ?? undefined,
    portfolio_url: item?.portfolio_url ?? undefined,
    has_brand_partnership_experience: item?.has_brand_partnership_experience ?? undefined,
  };
}

@Injectable()
export class CreatorsService {
  private readonly log = new Logger(CreatorsService.name);

  constructor(private prisma: PrismaService, private ai: AiService) {}

  /** One chat turn: the AI reads the conversation, updates the criteria, and asks the next question. */
  async chat(clientId: string, userId: string, messages: ChatMessage[]): Promise<CreatorChatReply> {
    if (!messages.length || messages.length > 40) throw new BadRequestException('Send between 1 and 40 messages.');
    const profile = await this.prisma.brandProfile.findUnique({ where: { clientId } });
    const reply = await this.ai.chatCreators(messages, profile ? { niche: profile.niche, audience: profile.audience } : null);
    return { ...reply, criteria: cleanCriteria(reply.criteria) };
  }

  /** Top creators for the criteria: live Discovery API when a Page is connected, sample data otherwise. */
  async search(clientId: string, input: Partial<CreatorCriteria>, limit = MAX_RESULTS): Promise<{ creators: CreatorResult[]; source: 'live' | 'sample'; notice?: string }> {
    const criteria = cleanCriteria(input);
    const count = Number.isInteger(limit) && limit >= 1 && limit <= 10 ? limit : MAX_RESULTS;
    const pages = await this.prisma.socialAccount.findMany({
      where: { clientId, provider: 'facebook_page', disconnectedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!pages.length) {
      return {
        creators: SAMPLE_CREATORS.slice(0, count),
        source: 'sample',
        notice: 'Sample creators: connect a Facebook Page (staff only, Connections) to search the live marketplace.',
      };
    }
    try {
      const v = graphVersion();
      // The marketplace is searched through a Page's linked Instagram account, so use the first Page that has one.
      let igId: string | undefined;
      let pageToken = '';
      for (const page of pages) {
        const token = decryptToken(page.accessToken);
        const linked = await axios.get(`https://graph.facebook.com/${v}/${page.externalId}`, {
          params: { fields: 'instagram_business_account{id}', access_token: token },
        });
        igId = linked.data?.instagram_business_account?.id;
        if (igId) { pageToken = token; break; }
      }
      if (!igId) {
        return {
          creators: SAMPLE_CREATORS.slice(0, count),
          source: 'sample',
          notice: 'Sample creators: link an Instagram business account to one of your connected Pages to search the live marketplace.',
        };
      }
      const res = await axios.get(`https://graph.facebook.com/${v}/${igId}/creator_marketplace_creators`, {
        params: { ...toParams(criteria, count), access_token: pageToken },
      });
      const creators = ((res.data?.data ?? []) as any[]).map(normalize).filter((c) => c.username).slice(0, count);
      return { creators, source: 'live' };
    } catch (e: any) {
      this.log.warn(`Creator search failed: ${this.msg(e)}`);
      throw new BadRequestException(this.msg(e));
    }
  }

  async shortlist(clientId: string, userId: string, creator: CreatorResult) {
    const username = creator.username?.trim().replace(/^@/, '');
    if (!username) throw new BadRequestException('A creator username is required.');
    const existing = await this.prisma.creatorShortlist.findUnique({ where: { clientId_username: { clientId, username } } });
    if (existing) return serializeShortlist(existing);
    const saved = await this.prisma.creatorShortlist.create({
      data: {
        clientId,
        userId,
        username,
        creatorId: creator.id ?? null,
        profilePictureUrl: creator.profile_picture_url ?? null,
        biography: creator.biography?.slice(0, 2000) ?? null,
        country: creator.country ?? null,
        followers: creator.followers ?? null,
        verified: creator.is_account_verified ?? null,
        data: JSON.stringify(creator).slice(0, 8000),
      },
    });
    return serializeShortlist(saved);
  }

  async listShortlist(clientId: string) {
    const rows = await this.prisma.creatorShortlist.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(serializeShortlist);
  }

  async removeShortlist(clientId: string, id: string) {
    const row = await this.prisma.creatorShortlist.findFirst({ where: { id, clientId }, select: { id: true } });
    if (!row) throw new NotFoundException('Saved creator not found.');
    await this.prisma.creatorShortlist.delete({ where: { id } });
  }

  /** Short, user-safe error text — never leaks secrets. */
  private msg(e: any): string {
    return (
      e?.response?.data?.error?.message ||
      e?.response?.data?.error ||
      e?.message ||
      'Something went wrong talking to Meta. Please try again.'
    );
  }
}

function serializeShortlist(row: { id: string; username: string; creatorId: string | null; profilePictureUrl: string | null; biography: string | null; country: string | null; followers: number | null; verified: boolean | null; createdAt: Date }) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
