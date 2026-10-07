/**
 * Sample workspaces for trying the app, and for checking screens without using a real account.
 *
 *   docker compose exec -e DEMO_SEED=yes backend node dist/scripts/seed-demo.js
 *   (or, outside Docker, after `npm run build`:  DEMO_SEED=yes npm run seed:demo)
 *
 * Two workspaces are created:
 *   - "Demo studio": a month of numbers, posts, drafts and ideas. demo@motion.test is an ADMIN with this as their home
 *     workspace, and can act as any other client.
 *   - "Acme Bakery" (a sample client): its own channel and a little content. acme@motion.test is its client user, with AI off
 *     as for any client an agency creates, so the two logins show how clients are kept apart.
 *
 * Sign in with the password below. Running it again resets these two users and their workspaces; nothing else is
 * touched. The channel holds a fake token, so nothing can be published to a real platform from it, and the sample posts
 * are scheduled days ahead so the publisher leaves them alone.
 */
import { PrismaClient, Role } from '@prisma/client';
import { encryptToken, hashPassword } from '../auth/crypto';

export const DEMO_EMAIL = 'demo@motion.test';
export const CLIENT_EMAIL = 'acme@motion.test';
export const DEMO_PASSWORD = 'motion-demo-2026'; // for these local sample accounts only

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
    // Start clean: remove the two sample users (which removes what they own), then their now-empty workspaces.
    const old = await prisma.user.findMany({ where: { email: { in: [DEMO_EMAIL, CLIENT_EMAIL] } }, select: { clientId: true } });
    await prisma.user.deleteMany({ where: { email: { in: [DEMO_EMAIL, CLIENT_EMAIL] } } });
    await prisma.client.deleteMany({ where: { id: { in: old.map((u) => u.clientId).filter((c): c is string => !!c) } } });

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const client = await prisma.client.create({ data: { name: 'Demo studio (sample data)' } });
    await prisma.clientFeatureFlag.create({ data: { clientId: client.id, featureKey: 'ai', enabled: true } });
    const user = await prisma.user.create({ data: { email: DEMO_EMAIL, passwordHash, role: Role.ADMIN, clientId: client.id } });
    await prisma.client.update({ where: { id: client.id }, data: { createdById: user.id } });
    const owner = { userId: user.id, clientId: client.id };
    const account = await prisma.socialAccount.create({
      data: {
        ...owner, provider: 'instagram', externalId: 'demo-instagram', name: 'Demo studio (sample data)',
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
        { ...owner, accountId: account.id, platform: 'instagram', mediaType: 'REELS', caption: 'Draft: what we learned from 100 reels', mediaUrls: '[]' },
        { ...owner, mediaType: 'IMAGE', caption: 'Draft: a quick note for the weekend', mediaUrls: '[]' },
      ],
    });

    await prisma.brandProfile.create({
      data: { ...owner, niche: 'Social media for small teams', audience: 'Founders and marketers', voice: 'Warm, direct, practical', pillars: JSON.stringify(['Education', 'Habits', 'Community']) },
    });
    await prisma.contentIdea.createMany({
      data: [
        { ...owner, title: 'The first-second test', hook: 'You have one second. Is this the first thing they see?', angle: 'A quick teardown of three openings', format: 'REEL', platform: 'instagram', pillar: 'Education', status: 'NEW', hashtags: '["contentstrategy","reels"]' },
        { ...owner, title: 'Plan the week on Monday', hook: 'Ten minutes on Monday saves five hours of scrambling.', format: 'CAROUSEL', platform: 'instagram', pillar: 'Habits', status: 'SAVED', hashtags: '["planning"]' },
        { ...owner, title: 'Ask the audience', hook: 'What is the one thing you wish you knew sooner?', format: 'IMAGE', platform: 'instagram', pillar: 'Community', status: 'NEW', hashtags: '[]' },
      ],
    });

    // A second, separate client: shows that one client never sees another, and what a client user's app looks like.
    const acme = await prisma.client.create({ data: { name: 'Acme Bakery (sample client)', createdById: user.id } });
    const acmeUser = await prisma.user.create({ data: { email: CLIENT_EMAIL, passwordHash, role: Role.CLIENT_POC, clientId: acme.id } });
    const acmeOwner = { userId: acmeUser.id, clientId: acme.id };
    const acmeAccount = await prisma.socialAccount.create({
      data: { ...acmeOwner, provider: 'instagram', externalId: 'demo-acme-instagram', name: 'Acme Bakery (sample data)', accessToken: encryptToken('demo-token-not-a-real-credential'), meta: JSON.stringify({ username: 'acme.bakery', followers_count: 840, media_count: 31 }), insightsSyncedAt: new Date() },
    });
    for (const [caption, mediaType, ahead] of [['Fresh sourdough every Saturday', 'IMAGE', 1.5], ['Meet the baker behind the counter', 'REELS', 4]] as const) {
      const at = new Date(now + ahead * DAY); at.setHours(8, 30, 0, 0);
      await prisma.scheduledPost.create({ data: { accountId: acmeAccount.id, platform: 'instagram', mediaType, caption, mediaUrls: '[]', scheduledAt: at, status: 'SCHEDULED', createdById: acmeUser.id } });
    }
    const acmePublished = await prisma.scheduledPost.create({
      data: { accountId: acmeAccount.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'Our croissants sold out by 9am', mediaUrls: '[]', scheduledAt: new Date(now - 3 * DAY), status: 'PUBLISHED', externalId: 'demo-acme-post-1', permalink: 'https://www.instagram.com/p/acme1/', createdById: acmeUser.id },
    });
    await prisma.postInsight.create({ data: { postId: acmePublished.id, accountId: acmeAccount.id, views: 1900, reach: 1400, likes: 120, comments: 14, shares: 20, saves: 33, engagements: 187 } });
    await prisma.postDraft.create({ data: { ...acmeOwner, accountId: acmeAccount.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'Draft: new autumn menu', mediaUrls: '[]' } });
    await prisma.brandProfile.create({ data: { ...acmeOwner, niche: 'A neighbourhood bakery', audience: 'Local families', voice: 'Friendly and warm', pillars: JSON.stringify(['Behind the scenes', 'New bakes']) } });

    console.log(`Sample workspaces ready (password: ${DEMO_PASSWORD}).
  ${DEMO_EMAIL}: admin, home workspace "Demo studio"
  ${CLIENT_EMAIL}: client user of "Acme Bakery"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
