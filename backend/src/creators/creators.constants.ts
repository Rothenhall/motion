import { z } from 'zod';

/** Follower bounds accepted by the Creator Marketplace Discovery API. */
export const FOLLOWER_BUCKETS = [0, 10000, 25000, 50000, 75000, 100000, 250000, 1000000] as const;

export const CREATOR_INTERESTS = [
  'ANIMALS_AND_PETS',
  'BOOKS_AND_LITERATURE',
  'BUSINESS_FINANCE_AND_ECONOMICS',
  'EDUCATION_AND_LEARNING',
  'BEAUTY',
  'FASHION',
  'FITNESS_AND_WORKOUTS',
  'FOOD_AND_DRINK',
  'GAMES_PUZZLES_AND_PLAY',
  'HISTORY_AND_PHILOSOPHY',
  'HOLIDAYS_AND_CELEBRATIONS',
  'HOME_AND_GARDEN',
  'MUSIC_AND_AUDIO',
  'PERFORMING_ARTS',
  'SCIENCE_AND_TECH',
  'SPORTS',
  'TV_AND_MOVIES',
  'TRAVEL_AND_LEISURE_ACTIVITIES',
  'VEHICLES_AND_TRANSPORTATION',
  'VISUAL_ARTS_ARCHITECTURE_AND_CRAFTS',
] as const;

export const CREATOR_GENDERS = ['male', 'female'] as const;

export const CREATOR_AGE_BUCKETS = ['18_to_24', '25_to_34', '35_to_44', '45_to_54', '55_to_64', '65_and_above'] as const;

export const RECOMMENDATION_TYPES = [
  'most_relevant_for_me',
  'high_ad_performance',
  'most_ads_experience',
  'similar_brands',
  'similar_audience',
] as const;

/** What the chat collects and what POST /creators/search accepts. Field names match the Discovery API. */
export const CreatorCriteriaSchema = z.object({
  query: z.string().trim().max(200).optional().describe('Free-text niche or keywords, e.g. sourdough baking'),
  creatorCountries: z.array(z.string().trim().length(2)).max(10).default([]).describe('Creator country ISO codes, e.g. ["US"]'),
  creatorMinFollowers: z.number().optional().describe('One of the follower bucket values'),
  creatorMaxFollowers: z.number().optional().describe('One of the follower bucket values'),
  creatorInterests: z.array(z.string()).max(5).default([]).describe('Values from the interest list'),
  creatorGender: z.string().optional().describe('male or female'),
  creatorAgeBucket: z.string().optional().describe('One of the age buckets'),
  majorAudienceCountries: z.array(z.string().trim().length(2)).max(10).default([]).describe('Audience country ISO codes'),
  recommendationType: z.string().optional().describe('One of the recommendation types'),
  similarTo: z.array(z.string().trim().max(30)).max(5).default([]).describe('Instagram usernames of reference creators'),
});

export type CreatorCriteria = z.infer<typeof CreatorCriteriaSchema>;

export const CreatorChatReplySchema = z.object({
  reply: z.string().describe('The next chat message to the user: one focused question, or a summary when ready'),
  criteria: CreatorCriteriaSchema,
  ready_to_search: z.boolean().describe('True when niche plus country plus follower range are known, or the user asked to search'),
  missing: z.array(z.string()).max(5).describe('Plain-word list of what is still needed, empty when ready'),
});

export type CreatorChatReply = z.infer<typeof CreatorChatReplySchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2000),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** Normalized creator shown on the Creators tab. Field names follow the Discovery API response. */
export type CreatorResult = {
  id?: string;
  username: string;
  profile_picture_url?: string;
  biography?: string;
  country?: string;
  gender?: string;
  followers?: number;
  is_account_verified?: boolean;
  onboarded_status?: string;
  email?: string;
  portfolio_url?: string;
  has_brand_partnership_experience?: boolean;
};

/** Test-data creators returned while the app has no Page token or only standard access. */
export const SAMPLE_CREATORS: CreatorResult[] = [
  { username: 'sample.creator.maya', biography: 'Baking sourdough and slow mornings.', country: 'US', followers: 42000, is_account_verified: false, onboarded_status: 'ONBOARDED', has_brand_partnership_experience: true },
  { username: 'sample.creator.ravi', biography: 'Street food tours in every city I visit.', country: 'IN', followers: 88000, is_account_verified: true, onboarded_status: 'ONBOARDED', has_brand_partnership_experience: true },
  { username: 'sample.creator.lena', biography: 'Capsule wardrobe and thrift flips.', country: 'GB', followers: 26000, is_account_verified: false, onboarded_status: 'ONBOARDED', has_brand_partnership_experience: false },
  { username: 'sample.creator.diego', biography: 'Trail running and marathon training plans.', country: 'ES', followers: 130000, is_account_verified: true, onboarded_status: 'ONBOARDED', has_brand_partnership_experience: true },
  { username: 'sample.creator.ana', biography: 'Skincare for sensitive skin, no filters.', country: 'BR', followers: 54000, is_account_verified: false, onboarded_status: 'ONBOARDED', has_brand_partnership_experience: false },
];
