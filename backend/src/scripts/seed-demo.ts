/**
 * Sample workspaces for trying the app, and for checking screens without using a real account.
 *
 *   docker compose exec -e DEMO_SEED=yes backend node dist/scripts/seed-demo.js
 *   (or, outside Docker, after `npm run build`:  DEMO_SEED=yes npm run seed:demo)
 *
 * It refuses to run unless DEMO_SEED=yes. Four client workspaces and one staff workspace are created:
 *   - "Demo studio": staff. A month of numbers, posts, drafts and ideas. demo@motion.test is an ADMIN with this as their
 *     home workspace, and can act as any client.
 *   - "Acme Bakery": a normal client. acme@motion.test is its main contact. Its team page has one person invited who has
 *     not accepted (acme-invited@motion.test) and one who was switched off (acme-disabled@motion.test). Its Activity tab
 *     has a short history: client created, AI switched on and off, channel connected, people invited.
 *   - "Northwind Studio": a restricted client. northwind@motion.test can plan and compose, but Analytics and AI are
 *     switched off. It has one connected channel (with a failed post) and one channel that staff disconnected, which
 *     keeps its history.
 *   - "Paused Co": a client that is suspended. paused@motion.test is shut out until staff activate the client.
 *
 * Every login uses the password DEMO_PASSWORD below (these are local sample accounts only; it is not printed).
 *
 * Running it again resets exactly these users and their workspaces, nothing else: only the @motion.test addresses listed
 * here are touched, and only the workspaces they belong to (and only if nobody else belongs to them). Channels hold fake
 * tokens, so nothing can be published to a real platform, and sample posts are scheduled days ahead so the publisher
 * leaves them alone. It does not create approval data.
 */
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { encryptToken, hashPassword } from '../auth/crypto';

export const DEMO_EMAIL = 'demo@motion.test';
export const CLIENT_EMAIL = 'acme@motion.test';
export const NORTHWIND_EMAIL = 'northwind@motion.test';
export const PAUSED_EMAIL = 'paused@motion.test';
export const ACME_INVITED_EMAIL = 'acme-invited@motion.test';
export const ACME_DISABLED_EMAIL = 'acme-disabled@motion.test';
export const SEED_EMAILS = [DEMO_EMAIL, CLIENT_EMAIL, NORTHWIND_EMAIL, PAUSED_EMAIL, ACME_INVITED_EMAIL, ACME_DISABLED_EMAIL];
export const DEMO_PASSWORD = 'motion-demo-2026'; // for these local sample accounts only

const DAY = 86_400_000;
const NO_PASSWORD = '!no-password-yet'; // the same placeholder invitations use: no password can ever match it

/** Repeatable "random" numbers, so the sample charts look the same every run. */
function lcg(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

/** Removes the sample users and the workspaces only they belong to. Touches nothing else. */
export async function removeSeed(prisma: PrismaClient) {
  const users = await prisma.user.findMany({ where: { email: { in: SEED_EMAILS } }, select: { id: true, clientId: true } });
  const candidates = [...new Set(users.map((u) => u.clientId).filter((c): c is string => !!c))];
  // A workspace is ours to delete only if every person in it is one of the sample users.
  const foreign = await prisma.user.findMany({ where: { clientId: { in: candidates }, email: { notIn: SEED_EMAILS } }, select: { clientId: true } });
  const clientIds = candidates.filter((id) => !foreign.some((f) => f.clientId === id));

  await prisma.adminAuditLog.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { actorId: { in: users.map((u) => u.id) } }] } });
  // Channels first (their posts, numbers, rules and comments go with them), then what else a workspace owns.
  await prisma.socialAccount.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.postDraft.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.contentIdea.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.hook.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.contentCheck.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.brandProfile.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
}

export async function seedDemo(prisma: PrismaClient) {
  await removeSeed(prisma);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY);
  const fakeToken = () => encryptToken('demo-token-not-a-real-credential');

  // ---------------------------------------------------------------- Demo studio (staff)
  const client = await prisma.client.create({ data: { name: 'Demo studio (sample data)' } });
  await prisma.clientFeatureFlag.create({ data: { clientId: client.id, featureKey: 'ai', enabled: true } });
  const user = await prisma.user.create({ data: { email: DEMO_EMAIL, passwordHash, role: Role.ADMIN, clientId: client.id } });
  await prisma.client.update({ where: { id: client.id }, data: { createdById: user.id } });
  const owner = { userId: user.id, clientId: client.id };
  const account = await prisma.socialAccount.create({
    data: {
      ...owner, provider: 'instagram', externalId: 'demo-instagram', name: 'Demo studio (sample data)',
      accessToken: fakeToken(),
      meta: JSON.stringify({ username: 'demo.studio', followers_count: 2640, media_count: 96 }),
      insightsSyncedAt: new Date(),
    },
  });

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

  /** A staff action in the Activity tab, `daysAgo` days back. */
  const audit = (clientId: string, daysAgo: number, action: string, extra: { actorId?: string; targetType?: string; targetId?: string; meta?: object } = {}) =>
    prisma.adminAuditLog.create({ data: { at: new Date(now - daysAgo * DAY), actorId: extra.actorId ?? user.id, clientId, action, targetType: extra.targetType, targetId: extra.targetId, meta: extra.meta } });
  /** An invitation that has not been used yet (the link itself is not stored, only this hash; staff can send a fresh one). */
  const openInvite = (userId: string) =>
    prisma.authToken.create({ data: { userId, type: 'INVITE', tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'), expiresAt: new Date(now + 2 * DAY), createdById: user.id } });

  // ---------------------------------------------------------------- Acme Bakery: a normal client with a small team
  const acme = await prisma.client.create({ data: { name: 'Acme Bakery (sample client)', createdById: user.id, createdAt: ago(21), notes: 'Neighbourhood bakery. Posts about new bakes twice a week.' } });
  const acmeUser = await prisma.user.create({ data: { email: CLIENT_EMAIL, passwordHash, role: Role.CLIENT_POC, clientId: acme.id, invitedById: user.id, lastLoginAt: ago(1) } });
  const acmeInvited = await prisma.user.create({ data: { email: ACME_INVITED_EMAIL, passwordHash: NO_PASSWORD, role: Role.CLIENT_MEMBER, status: UserStatus.INVITED, clientId: acme.id, invitedById: acmeUser.id } });
  const acmeDisabled = await prisma.user.create({ data: { email: ACME_DISABLED_EMAIL, passwordHash, role: Role.CLIENT_MEMBER, status: UserStatus.DISABLED, clientId: acme.id, invitedById: acmeUser.id, sessionVersion: 1 } });
  await openInvite(acmeInvited.id);
  // AI was switched on for a trial and off again, so the switch ends up off (as for any new client).
  await prisma.clientFeatureFlag.create({ data: { clientId: acme.id, featureKey: 'ai', enabled: false, updatedById: user.id } });
  const acmeOwner = { userId: acmeUser.id, clientId: acme.id };
  const acmeAccount = await prisma.socialAccount.create({
    data: { userId: user.id, clientId: acme.id, provider: 'instagram', externalId: 'demo-acme-instagram', name: 'Acme Bakery (sample data)', accessToken: fakeToken(), meta: JSON.stringify({ username: 'acme.bakery', followers_count: 840, media_count: 31 }), insightsSyncedAt: new Date(), createdAt: ago(20) },
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

  await audit(acme.id, 21, 'client.create', { targetType: 'client', targetId: acme.id, meta: { name: 'Acme Bakery (sample client)' } });
  await audit(acme.id, 21, 'user.invite', { targetType: 'user', targetId: acmeUser.id, meta: { email: CLIENT_EMAIL, role: 'CLIENT_POC' } });
  await audit(acme.id, 20.9, 'user.accept_invite', { actorId: acmeUser.id, targetType: 'user', targetId: acmeUser.id });
  await audit(acme.id, 20, 'channel.connect', { targetType: 'channel', targetId: acmeAccount.id, meta: { provider: 'instagram', label: 'Acme Bakery (sample data)' } });
  await audit(acme.id, 18, 'feature.set', { targetType: 'feature', targetId: 'ai', meta: { enabled: true } });
  await audit(acme.id, 11, 'feature.set', { targetType: 'feature', targetId: 'ai', meta: { enabled: false } });
  await audit(acme.id, 9, 'user.invite', { actorId: acmeUser.id, targetType: 'user', targetId: acmeDisabled.id, meta: { email: ACME_DISABLED_EMAIL, role: 'CLIENT_MEMBER' } });
  await audit(acme.id, 6, 'user.disable', { targetType: 'user', targetId: acmeDisabled.id });
  await audit(acme.id, 2, 'user.invite', { actorId: acmeUser.id, targetType: 'user', targetId: acmeInvited.id, meta: { email: ACME_INVITED_EMAIL, role: 'CLIENT_MEMBER' } });

  // ---------------------------------------------------------------- Northwind Studio: a restricted client
  const northwind = await prisma.client.create({ data: { name: 'Northwind Studio (sample client)', createdById: user.id, createdAt: ago(14), seatLimit: 2, notes: 'Plans and writes only. No analytics or AI on this plan.' } });
  const northwindUser = await prisma.user.create({ data: { email: NORTHWIND_EMAIL, passwordHash, role: Role.CLIENT_POC, clientId: northwind.id, invitedById: user.id, lastLoginAt: ago(2) } });
  await prisma.clientFeatureFlag.create({ data: { clientId: northwind.id, featureKey: 'analytics', enabled: false, updatedById: user.id } });
  await prisma.clientFeatureFlag.create({ data: { clientId: northwind.id, featureKey: 'ai', enabled: false, updatedById: user.id } }); // off by default; written down so it is plain that it was a choice
  const nwOwner = { userId: northwindUser.id, clientId: northwind.id };
  const nwInstagram = await prisma.socialAccount.create({
    data: { userId: user.id, clientId: northwind.id, provider: 'instagram', externalId: 'demo-northwind-instagram', name: 'Northwind Studio (sample data)', accessToken: fakeToken(), meta: JSON.stringify({ username: 'northwind.studio', followers_count: 5120, media_count: 204 }), insightsSyncedAt: new Date(), createdAt: ago(13) },
  });
  const nwThreads = await prisma.socialAccount.create({
    data: {
      userId: user.id, clientId: northwind.id, provider: 'threads', externalId: 'demo-northwind-threads', name: 'Northwind on Threads (sample data)',
      accessToken: encryptToken('disconnected'), // what disconnecting leaves behind: no usable token
      meta: JSON.stringify({ username: 'northwind.studio', followers_count: 310 }), disconnectedAt: ago(5), createdAt: ago(13),
    },
  });
  // The disconnected channel keeps its history.
  await prisma.accountInsight.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ accountId: nwThreads.id, date: new Date(today.getTime() - (14 - i) * DAY), metric: 'followers', value: 290 + i * 2 })),
  });
  const threadsPost = await prisma.scheduledPost.create({
    data: { accountId: nwThreads.id, platform: 'threads', mediaType: 'TEXT', caption: 'We are changing how we plan launches. A short thread.', mediaUrls: '[]', scheduledAt: ago(8), status: 'PUBLISHED', externalId: 'demo-northwind-threads-post-1', createdById: northwindUser.id },
  });
  await prisma.postInsight.create({ data: { postId: threadsPost.id, accountId: nwThreads.id, views: 640, likes: 41, comments: 5, shares: 3, engagements: 49 } });
  for (const [caption, mediaType, ahead] of [['Studio tour, part one', 'REELS', 2.5], ['Poster of the month', 'IMAGE', 6]] as const) {
    const at = new Date(now + ahead * DAY); at.setHours(10, 0, 0, 0);
    await prisma.scheduledPost.create({ data: { accountId: nwInstagram.id, platform: 'instagram', mediaType, caption, mediaUrls: '[]', scheduledAt: at, status: 'SCHEDULED', createdById: northwindUser.id } });
  }
  await prisma.scheduledPost.create({
    data: { accountId: nwInstagram.id, platform: 'instagram', mediaType: 'REELS', caption: 'Behind the scenes: print day', mediaUrls: '[]', scheduledAt: ago(1), status: 'FAILED', error: 'Sample failure: Instagram rejected the video.', createdById: northwindUser.id },
  });
  await prisma.postDraft.create({ data: { ...nwOwner, accountId: nwInstagram.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'Draft: spring collection teaser', mediaUrls: '[]' } });

  await audit(northwind.id, 14, 'client.create', { targetType: 'client', targetId: northwind.id, meta: { name: 'Northwind Studio (sample client)' } });
  await audit(northwind.id, 14, 'user.invite', { targetType: 'user', targetId: northwindUser.id, meta: { email: NORTHWIND_EMAIL, role: 'CLIENT_POC' } });
  await audit(northwind.id, 14, 'feature.set', { targetType: 'feature', targetId: 'analytics', meta: { enabled: false } });
  await audit(northwind.id, 13, 'channel.connect', { targetType: 'channel', targetId: nwInstagram.id, meta: { provider: 'instagram', label: 'Northwind Studio (sample data)' } });
  await audit(northwind.id, 13, 'channel.connect', { targetType: 'channel', targetId: nwThreads.id, meta: { provider: 'threads', label: 'Northwind on Threads (sample data)' } });
  await audit(northwind.id, 5, 'channel.disconnect', { targetType: 'channel', targetId: nwThreads.id, meta: { provider: 'threads' } });

  // ---------------------------------------------------------------- Paused Co: suspended
  const paused = await prisma.client.create({ data: { name: 'Paused Co (sample client)', createdById: user.id, createdAt: ago(30), status: 'SUSPENDED' } });
  const pausedUser = await prisma.user.create({ data: { email: PAUSED_EMAIL, passwordHash, role: Role.CLIENT_POC, clientId: paused.id, invitedById: user.id, lastLoginAt: ago(10) } });
  const pausedAccount = await prisma.socialAccount.create({
    data: { userId: user.id, clientId: paused.id, provider: 'instagram', externalId: 'demo-paused-instagram', name: 'Paused Co (sample data)', accessToken: fakeToken(), meta: JSON.stringify({ username: 'paused.co', followers_count: 1200 }), insightsSyncedAt: new Date(), createdAt: ago(29) },
  });
  await prisma.scheduledPost.create({ data: { accountId: pausedAccount.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'This will not go out while the client is paused', mediaUrls: '[]', scheduledAt: new Date(now + 3 * DAY), status: 'SCHEDULED', createdById: pausedUser.id } });
  await audit(paused.id, 30, 'client.create', { targetType: 'client', targetId: paused.id, meta: { name: 'Paused Co (sample client)' } });
  await audit(paused.id, 29, 'channel.connect', { targetType: 'channel', targetId: pausedAccount.id, meta: { provider: 'instagram', label: 'Paused Co (sample data)' } });
  await audit(paused.id, 4, 'client.suspend', { targetType: 'client', targetId: paused.id });

  return { clients: [client.id, acme.id, northwind.id, paused.id] };
}

async function main() {
  if (process.env.DEMO_SEED !== 'yes') {
    console.error('Refusing to seed: set DEMO_SEED=yes to confirm this is a development database.');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    await seedDemo(prisma);
    console.log(`Sample workspaces ready. Every login uses DEMO_PASSWORD from src/scripts/seed-demo.ts.
  ${DEMO_EMAIL}: staff, home workspace "Demo studio"
  ${CLIENT_EMAIL}: main contact of "Acme Bakery" (a team of three: one invited, one switched off)
  ${NORTHWIND_EMAIL}: main contact of "Northwind Studio" (Analytics and AI off; one channel disconnected)
  ${PAUSED_EMAIL}: main contact of "Paused Co" (suspended: signing in is refused)`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
