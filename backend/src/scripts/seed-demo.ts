/**
 * Sample workspace for trying the app, and for checking screens without using a real account.
 *
 *   docker compose exec -e DEMO_SEED=yes backend node dist/scripts/seed-demo.js
 *   (or, outside Docker, after `npm run build`:  DEMO_SEED=yes npm run seed:demo)
 *
 * Sign in as demo@motion.test with the password below. Running it again resets that one user's data; no other user is
 * touched. The channel holds a fake token, so nothing can be published to a real platform from it, and the sample posts
 * are scheduled days ahead so the publisher leaves them alone.
 */
import { PrismaClient } from '@prisma/client';
import { encryptToken, hashPassword } from '../auth/crypto';

export const DEMO_EMAIL = 'demo@motion.test';
export const DEMO_PASSWORD = 'motion-demo-2026'; // for this local sample account only

const DAY = 86_400_000;

/** Repeatable "random" numbers, so the sample charts look the same every run. */
function lcg(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

async function main() {
  if (process.env.DEMO_SEED !== 'yes') {
    console.error('Refusing to seed: set DEMO_SEED=yes to confirm this is a development database.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } }); // cascades to its channels, posts, drafts and ideas
    const user = await prisma.user.create({ data: { email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD) } });
    const account = await prisma.socialAccount.create({
      data: {
        userId: user.id, provider: 'instagram', externalId: 'demo-instagram', name: 'Demo studio (sample data)',
        accessToken: encryptToken('demo-token-not-a-real-credential'),
        meta: JSON.stringify({ username: 'demo.studio', followers_count: 2640, media_count: 96 }),
        insightsSyncedAt: new Date(),
      },
    });

    const now = Date.now();
    const rand = lcg(7);

    // A month of account numbers.
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const days = Array.from({ length: 30 }, (_, i) => new Date(today.getTime() - (29 - i) * DAY));
    await prisma.accountInsight.createMany({
      data: days.flatMap((date, i) => [
        { accountId: account.id, date, metric: 'followers', value: 2400 + i * 8 + Math.round(rand() * 6) },
        { accountId: account.id, date, metric: 'views', value: 700 + Math.round(rand() * 900) + (i % 7 === 4 ? 600 : 0) },
        { accountId: account.id, date, metric: 'reach', value: 400 + Math.round(rand() * 500) },
        { accountId: account.id, date, metric: 'engagements', value: 40 + Math.round(rand() * 90) },
      ]),
    });

    // Published posts with results, spread over the month.
    const published = [
      ['Three small habits that doubled our reach', 'REELS', 9100], ['Behind the scenes of a product shoot', 'IMAGE', 2300],
      ['Stop posting at random times. Do this instead.', 'REELS', 7400], ['Our honest month in numbers', 'CAROUSEL', 3900],
      ['The caption formula we use every week', 'IMAGE', 2800], ['Why your first second matters most', 'REELS', 11800],
      ['Monday reset: plan the week in 10 minutes', 'IMAGE', 1900], ['What we would tell ourselves a year ago', 'CAROUSEL', 3100],
    ] as const;
    for (const [n, [caption, mediaType, views]] of published.entries()) {
      const at = new Date(now - (n * 3.6 + 1) * DAY);
      at.setHours(9 + (n % 4) * 3, 0, 0, 0);
      const post = await prisma.scheduledPost.create({
        data: { accountId: account.id, platform: 'instagram', mediaType, caption, mediaUrls: '[]', scheduledAt: at, status: 'PUBLISHED', externalId: `demo-post-${n}`, permalink: `https://www.instagram.com/p/demo${n}/` },
      });
      await prisma.postInsight.create({
        data: { postId: post.id, accountId: account.id, views, reach: Math.round(views * 0.72), likes: Math.round(views * 0.06), comments: Math.round(views * 0.006), shares: Math.round(views * 0.01), saves: Math.round(views * 0.015), engagements: Math.round(views * 0.09) },
      });
    }

    // Coming up (days ahead, so the publisher never picks them up) and one that failed.
    const upcoming = [
      ['Launch week: what is changing and why', 'REELS', 2], ['Five tools we use to plan content', 'CAROUSEL', 3.2], ['Question of the week: what should we cover next?', 'IMAGE', 5],
    ] as const;
    for (const [caption, mediaType, ahead] of upcoming) {
      const at = new Date(now + ahead * DAY); at.setHours(11, 0, 0, 0);
      await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'instagram', mediaType, caption, mediaUrls: '[]', scheduledAt: at, status: 'SCHEDULED' } });
    }
    await prisma.scheduledPost.create({
      data: { accountId: account.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'A post that could not be published', mediaUrls: '[]', scheduledAt: new Date(now - 2 * DAY), status: 'FAILED', error: 'Sample failure: the file could not be fetched.' },
    });

    await prisma.postDraft.createMany({
      data: [
        { userId: user.id, accountId: account.id, platform: 'instagram', mediaType: 'REELS', caption: 'Draft: what we learned from 100 reels', mediaUrls: '[]' },
        { userId: user.id, mediaType: 'IMAGE', caption: 'Draft: a quick note for the weekend', mediaUrls: '[]' },
      ],
    });

    await prisma.brandProfile.create({
      data: { userId: user.id, niche: 'Social media for small teams', audience: 'Founders and marketers', voice: 'Warm, direct, practical', pillars: JSON.stringify(['Education', 'Habits', 'Community']) },
    });
    await prisma.contentIdea.createMany({
      data: [
        { userId: user.id, title: 'The first-second test', hook: 'You have one second. Is this the first thing they see?', angle: 'A quick teardown of three openings', format: 'REEL', platform: 'instagram', pillar: 'Education', status: 'NEW', hashtags: '["contentstrategy","reels"]' },
        { userId: user.id, title: 'Plan the week on Monday', hook: 'Ten minutes on Monday saves five hours of scrambling.', format: 'CAROUSEL', platform: 'instagram', pillar: 'Habits', status: 'SAVED', hashtags: '["planning"]' },
        { userId: user.id, title: 'Ask the audience', hook: 'What is the one thing you wish you knew sooner?', format: 'IMAGE', platform: 'instagram', pillar: 'Community', status: 'NEW', hashtags: '[]' },
      ],
    });

    console.log(`Demo workspace ready. Sign in as ${DEMO_EMAIL} (password: ${DEMO_PASSWORD}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
