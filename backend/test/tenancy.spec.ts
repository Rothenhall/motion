import { ExecutionContext, INestApplication, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { SchedulerService } from '../src/scheduler.service';
import { AutomationsService } from '../src/automations.service';
import { UPLOAD_DIR } from '../src/media.controller';
import { encryptToken, hashPassword, signToken } from '../src/auth/crypto';
import { FeaturesService } from '../src/tenancy/features.service';
import { TenancyBackfillService } from '../src/tenancy/backfill.service';
import { FEATURE_DEFAULTS, FEATURE_KEYS } from '../src/tenancy/features.constants';
import { Roles, RolesGuard } from '../src/tenancy/guards';

/**
 * Client workspaces: nobody can see or change another client's data, switches and suspension are enforced, and an admin
 * can act as any client. The first tests try to cross every boundary; the route list at the end fails when a new route
 * is added without being classified here.
 */
describe('Client workspaces', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let features: FeaturesService;
  const pub = { publish: jest.fn(), replyInstagramComment: jest.fn(async () => ({ id: 'reply-1' })), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn() };
  // The AI is stubbed, as in the pre-flight spec: these tests are about who can run and read a check, not about the review.
  const ai = {
    configured: true,
    model: 'test-model',
    reviewContent: jest.fn(async (_input: any) => ({
      verdict: 'A clear, simple post.',
      hook: { rating: 'STRONG', score: 72, reason: 'It opens on the point.' },
      dimensions: [{ key: 'HOOK', rating: 'STRONG', note: 'Direct' }],
      insights: [{ title: 'Keep the opening', detail: 'It works.', fix: 'Leave it as is.', severity: 'LOW', startSec: null, endSec: null, basis: 'COPY_REVIEW' }],
      alternativeHooks: ['One', 'Two', 'Three'],
    })),
  };
  const http = () => request(app.getHttpServer());
  const made = { clients: [] as string[], users: [] as string[], files: [] as string[], externalIds: [] as string[] };

  const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

  async function makeUser(email: string, role: Role, clientId: string) {
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword('password123'), role, clientId } });
    made.users.push(user.id);
    return { user, token: signToken(user.id, 'session', 3600) };
  }

  async function makeClient(name: string, opts: { ai?: boolean } = {}) {
    const client = await prisma.client.create({ data: { name } });
    made.clients.push(client.id);
    if (opts.ai) await features.set(client.id, 'ai', true);
    return client;
  }

  /** One client with a user and one of everything a client owns. */
  async function world(label: string, opts: { ai?: boolean } = {}) {
    const client = await makeClient(`Tenancy ${label}`, opts);
    const { user, token } = await makeUser(`tenancy-${label}@example.com`, Role.CLIENT_POC, client.id);
    const own = { userId: user.id, clientId: client.id };
    const externalId = `ig-${label}-${Date.now()}`;
    made.externalIds.push(externalId);
    const account = await prisma.socialAccount.create({ data: { ...own, provider: 'instagram', externalId, name: `@${label}`, accessToken: encryptToken('token') } });
    const draft = await prisma.postDraft.create({ data: { ...own, caption: `draft ${label}` } });
    const post = await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'instagram', mediaType: 'IMAGE', caption: `post ${label}`, mediaUrls: '[]', scheduledAt: new Date(Date.now() + 86_400_000), createdById: user.id } });
    const idea = await prisma.contentIdea.create({ data: { ...own, title: `idea ${label}`, hook: 'h', format: 'REEL', platform: 'instagram' } });
    const hook = await prisma.hook.create({ data: { ...own, text: `hook ${label}`, category: 'CURIOSITY', source: 'CUSTOM' } });
    const check = await prisma.contentCheck.create({ data: { ...own, kind: 'TEXT', platform: 'instagram', text: 'a text post', status: 'DONE' } });
    const rule = await prisma.automationRule.create({ data: { accountId: account.id, name: `rule ${label}`, keyword: 'price' } });
    const comment = await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'instagram', commentId: `c-${label}-${Date.now()}`, text: 'hello' } });
    const profile = await prisma.brandProfile.create({ data: { ...own, niche: `niche ${label}` } });
    return { client, user, token, account, draft, post, idea, hook, check, rule, comment, profile };
  }
  type World = Awaited<ReturnType<typeof world>>;

  let A: World;
  let B: World;
  let admin: { user: { id: string; clientId: string | null }; token: string };
  let adminHome: { id: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).overrideProvider(AiService).useValue(ai).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    features = app.get(FeaturesService);

    A = await world('a');
    B = await world('b');
    adminHome = await makeClient('Tenancy admin home');
    admin = await makeUser('tenancy-admin@example.com', Role.ADMIN, adminHome.id);
  });

  afterAll(async () => {
    // The test database is shared with the other specs, some of which expect to start with no users: leave nothing behind.
    const extra = await prisma.user.findMany({ where: { email: { startsWith: 'tenancy-' } }, select: { id: true, clientId: true } });
    const userIds = [...new Set([...made.users, ...extra.map((u) => u.id)])];
    const clientIds = [...new Set([...made.clients, ...extra.map((u) => u.clientId).filter((c): c is string => !!c)])];
    await prisma.socialAccount.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { externalId: { in: made.externalIds } }] } });
    await prisma.contentCheck.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.postDraft.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.contentIdea.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.hook.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.brandProfile.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const f of made.files) rmSync(join(UPLOAD_DIR, f), { force: true });
    await app.close();
  });

  // ---------------------------------------------------------------- isolation

  describe('one client never sees another', () => {
    // [route, the ids a response lists, which of a world's rows it should list]
    const LISTS: [string, (body: any) => string[], keyof World][] = [
      ['/accounts', (b) => b.map((i: any) => i.id), 'account'],
      ['/posts', (b) => b.map((i: any) => i.id), 'post'],
      ['/drafts', (b) => b.map((i: any) => i.id), 'draft'],
      ['/ideas', (b) => b.map((i: any) => i.id), 'idea'],
      ['/hooks', (b) => b.map((i: any) => i.id), 'hook'],
      ['/comments/events', (b) => b.map((i: any) => i.id), 'comment'],
      ['/automations', (b) => b.map((i: any) => i.id), 'rule'],
      ['/preflight', (b) => b.map((i: any) => i.id), 'check'],
      ['/brand-profile', (b) => [b.id], 'profile'],
      ['/dashboard', (b) => b.accounts.map((i: any) => i.id), 'account'],
      ['/analytics', (b) => b.channels.map((i: any) => i.accountId), 'account'],
    ];

    it.each(LISTS)('GET %s lists only the signed-in client\'s rows', async (path, ids, key) => {
      const a = (A[key] as { id: string }).id;
      const b = (B[key] as { id: string }).id;
      const asA = ids((await http().get(path).set(bearer(A.token)).expect(200)).body);
      expect(asA).toContain(a);
      expect(asA).not.toContain(b);
      const asB = ids((await http().get(path).set(bearer(B.token)).expect(200)).body);
      expect(asB).toContain(b);
      expect(asB).not.toContain(a);
    });

    it.each(LISTS)('GET %s: an admin sees the client they act as, and only that one', async (path, ids, key) => {
      const a = (A[key] as { id: string }).id;
      const b = (B[key] as { id: string }).id;
      const actingA = ids((await http().get(path).set(bearer(admin.token, { 'X-Client-Id': A.client.id })).expect(200)).body);
      expect(actingA).toContain(a);
      expect(actingA).not.toContain(b);
      const actingB = ids((await http().get(path).set(bearer(admin.token, { 'X-Client-Id': B.client.id })).expect(200)).body);
      expect(actingB).toContain(b);
      expect(actingB).not.toContain(a);
      // No header: the admin's own workspace, which holds neither client's rows.
      const home = ids((await http().get(path).set(bearer(admin.token)).expect(200)).body);
      expect(home).not.toContain(a);
      expect(home).not.toContain(b);
    });

    it('another client\'s ids answer 404 and change nothing', async () => {
      const t = bearer(A.token);
      await http().patch(`/posts/${B.post.id}`).set(t).send({ caption: 'hijack' }).expect(404);
      await http().delete(`/posts/${B.post.id}`).set(t).expect(404);
      await http().patch(`/drafts/${B.draft.id}`).set(t).send({ caption: 'hijack' }).expect(404);
      await http().delete(`/drafts/${B.draft.id}`).set(t).expect(404);
      await http().patch(`/ideas/${B.idea.id}`).set(t).send({ status: 'SAVED' }).expect(404);
      await http().patch(`/hooks/${B.hook.id}/favorite`).set(t).expect(404);
      await http().post(`/hooks/${B.hook.id}/use`).set(t).expect(404);
      await http().patch(`/automations/${B.rule.id}/toggle`).set(t).expect(404);
      await http().delete(`/automations/${B.rule.id}`).set(t).expect(404);
      await http().get(`/preflight/${B.check.id}`).set(t).expect(404);
      await http().get(`/preflight/${B.check.id}/brain`).set(t).expect(404);
      await http().delete(`/accounts/${B.account.id}`).set(t).expect(404);
      // Deletes that answer "no content" whether or not anything matched must still leave B's rows alone.
      await http().delete(`/ideas/${B.idea.id}`).set(t).expect(204);
      await http().delete(`/hooks/${B.hook.id}`).set(t).expect(204);
      await http().delete(`/preflight/${B.check.id}`).set(t).expect(204);

      expect(await prisma.scheduledPost.findUnique({ where: { id: B.post.id } })).toMatchObject({ caption: 'post b' });
      expect(await prisma.postDraft.findUnique({ where: { id: B.draft.id } })).toMatchObject({ caption: 'draft b' });
      expect(await prisma.contentIdea.findUnique({ where: { id: B.idea.id } })).toMatchObject({ status: 'NEW' });
      expect(await prisma.hook.findUnique({ where: { id: B.hook.id } })).not.toBeNull();
      expect(await prisma.contentCheck.findUnique({ where: { id: B.check.id } })).not.toBeNull();
      expect(await prisma.automationRule.findUnique({ where: { id: B.rule.id } })).toMatchObject({ isActive: true });
      expect(await prisma.socialAccount.findUnique({ where: { id: B.account.id } })).not.toBeNull();
    });

    it('another client\'s ids cannot be smuggled in through a request body', async () => {
      const t = bearer(A.token);
      const when = new Date(Date.now() + 3_600_000).toISOString();
      await http().post('/posts').set(t).send({ accountId: B.account.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: when }).expect(400);
      await http().post('/drafts').set(t).send({ accountId: B.account.id }).expect(400);
      await http().post('/automations').set(t).send({ accountId: B.account.id, name: 'x', keyword: 'k' }).expect(400);
      await http().post('/comments/reply').set(t).send({ platform: 'instagram', commentId: 'x', text: 'hi', accountId: B.account.id }).expect(400);

      // A foreign idea is ignored rather than linked or marked used.
      const ok = await http().post('/posts').set(t).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: when, ideaId: B.idea.id }).expect(201);
      expect(ok.body.idea).toBeNull();
      expect(await prisma.contentIdea.findUnique({ where: { id: B.idea.id } })).toMatchObject({ status: 'NEW' });
      // A foreign draft id is not consumed either.
      await http().post('/posts').set(t).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: when, draftId: B.draft.id }).expect(201);
      expect(await prisma.postDraft.findUnique({ where: { id: B.draft.id } })).not.toBeNull();
    });

    it('rows a client creates belong to that client, attributed to whoever made them', async () => {
      const draft = await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': A.client.id })).send({ caption: 'made by staff' }).expect(201);
      expect(await prisma.postDraft.findUnique({ where: { id: draft.body.id } })).toMatchObject({ clientId: A.client.id, userId: admin.user.id });
      expect((await http().get('/drafts').set(bearer(B.token)).expect(200)).body.map((d: any) => d.id)).not.toContain(draft.body.id);
    });
  });

  // ---------------------------------------------------------------- who is calling

  describe('acting as a client', () => {
    it('a client user may never name a client', async () => {
      const res = await http().get('/posts').set(bearer(A.token, { 'X-Client-Id': B.client.id })).expect(403);
      expect(res.body.code).toBe('ACT_AS_FORBIDDEN');
      await http().get('/posts').set(bearer(A.token, { 'X-Client-Id': A.client.id })).expect(403); // not even their own
    });

    it('an admin cannot act as a client that does not exist or was archived', async () => {
      await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': 'no-such-client' })).expect(404);
      const gone = await makeClient('Tenancy archived');
      await prisma.client.update({ where: { id: gone.id }, data: { archivedAt: new Date() } });
      await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': gone.id })).expect(404);
    });

    it('/auth/me tells the app who is acting and what is on', async () => {
      const client = (await http().get('/auth/me').set(bearer(A.token)).expect(200)).body;
      expect(client).toMatchObject({ role: 'CLIENT_POC', canActAs: false, acting: false, client: { id: A.client.id, status: 'ACTIVE' } });
      expect(client.features).toEqual(FEATURE_DEFAULTS);

      const acting = (await http().get('/auth/me').set(bearer(admin.token, { 'X-Client-Id': A.client.id, 'X-Preview-Mode': 'view' })).expect(200)).body;
      expect(acting).toMatchObject({ role: 'ADMIN', canActAs: true, acting: true, readOnlyPreview: true, client: { id: A.client.id } });
      const home = (await http().get('/auth/me').set(bearer(admin.token, { 'X-Client-Id': adminHome.id, 'X-Preview-Mode': 'view' })).expect(200)).body;
      expect(home).toMatchObject({ acting: false, readOnlyPreview: false }); // naming your own workspace is not previewing
    });

    it('"view as client" previews are read only; admin controls can write', async () => {
      const view = bearer(admin.token, { 'X-Client-Id': A.client.id, 'X-Preview-Mode': 'view' });
      await http().get('/posts').set(view).expect(200);
      const blocked = await http().post('/drafts').set(view).send({ caption: 'nope' }).expect(403);
      expect(blocked.body.code).toBe('PREVIEW_READ_ONLY');
      await http().patch(`/posts/${A.post.id}`).set(view).send({ caption: 'nope' }).expect(403);
      await http().delete(`/posts/${A.post.id}`).set(view).expect(403);
      expect(await prisma.scheduledPost.findUnique({ where: { id: A.post.id } })).toMatchObject({ caption: 'post a' });
      await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': A.client.id })).send({ caption: 'allowed with admin controls' }).expect(201);
    });

    it('disabled users and suspended workspaces are shut out immediately', async () => {
      const disabled = await makeUser('tenancy-disabled@example.com', Role.CLIENT_MEMBER, A.client.id);
      await http().get('/posts').set(bearer(disabled.token)).expect(200);
      await prisma.user.update({ where: { id: disabled.user.id }, data: { status: 'DISABLED' } });
      await http().get('/posts').set(bearer(disabled.token)).expect(401);

      const paused = await world('paused');
      await prisma.client.update({ where: { id: paused.client.id }, data: { status: 'SUSPENDED' } });
      const res = await http().get('/posts').set(bearer(paused.token)).expect(403);
      expect(res.body.code).toBe('CLIENT_SUSPENDED');
      // Staff can still open a suspended client to look after it.
      await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': paused.client.id })).expect(200);
    });

    it('roles come from the database, not from the token', async () => {
      const outsider = await makeUser('tenancy-poc@example.com', Role.CLIENT_POC, A.client.id);
      const forged = signToken(outsider.user.id, 'session', 3600, { role: 'ADMIN' });
      await http().get('/posts').set(bearer(forged, { 'X-Client-Id': B.client.id })).expect(403);
    });

    it('RolesGuard answers 404 to anyone outside the allowed roles', () => {
      class Dummy { @Roles(Role.ADMIN) handler() {} }
      const guard = new RolesGuard(new Reflector());
      const context = (role: Role) => ({ getHandler: () => Dummy.prototype.handler, getClass: () => Dummy, switchToHttp: () => ({ getRequest: () => ({ ctx: { user: { role } } }) }) }) as unknown as ExecutionContext;
      expect(guard.canActivate(context(Role.ADMIN))).toBe(true);
      expect(() => guard.canActivate(context(Role.CLIENT_POC))).toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- switches

  describe('feature switches', () => {
    it('start from the defaults, and AI is off until someone turns it on', async () => {
      const fresh = await world('fresh');
      expect((await http().get('/auth/me').set(bearer(fresh.token)).expect(200)).body.features.ai).toBe(false);
      await http().get('/posts').set(bearer(fresh.token)).expect(200);
      for (const [method, path] of [['post', '/ideas/generate'], ['post', '/hooks/generate'], ['post', '/preflight']] as const) {
        const res = await http()[method](path).set(bearer(fresh.token)).send({}).expect(403);
        expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'ai' });
      }
      await features.set(fresh.client.id, 'ai', true);
      expect((await http().get('/auth/me').set(bearer(fresh.token)).expect(200)).body.features.ai).toBe(true);
    });

    it('a switched-off section is closed to the client and open to staff', async () => {
      const w = await world('sections');
      await features.set(w.client.id, 'planner', false);
      const res = await http().get('/posts').set(bearer(w.token)).expect(403);
      expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'planner' });
      await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': w.client.id })).expect(200);
      await features.set(w.client.id, 'planner', true);
      await http().get('/posts').set(bearer(w.token)).expect(200);

      for (const [key, path] of [['inbox', '/comments/events'], ['automations', '/automations'], ['analytics', '/analytics'], ['content-lab', '/ideas'], ['preflight', '/preflight']] as const) {
        await features.set(w.client.id, key, false);
        expect((await http().get(path).set(bearer(w.token)).expect(403)).body.feature).toBe(key);
      }
    });

    it('switched-off actions block only that action', async () => {
      const w = await world('actions');
      const when = new Date(Date.now() + 3_600_000).toISOString();
      const post = { accountId: w.account.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: when };

      await features.set(w.client.id, 'schedule', false);
      expect((await http().post('/posts').set(bearer(w.token)).send(post).expect(403)).body.feature).toBe('schedule');
      await http().post('/drafts').set(bearer(w.token)).send({ caption: 'still fine' }).expect(201);
      await features.set(w.client.id, 'schedule', true);

      await features.set(w.client.id, 'delete-posts', false);
      expect((await http().delete(`/posts/${w.post.id}`).set(bearer(w.token)).expect(403)).body.feature).toBe('delete-posts');
      await features.set(w.client.id, 'delete-posts', true);

      await features.set(w.client.id, 'compose', false);
      await http().post('/drafts').set(bearer(w.token)).send({ caption: 'x' }).expect(403);
      await http().patch(`/posts/${w.post.id}`).set(bearer(w.token)).send({ caption: 'x' }).expect(403);
      await http().get('/posts').set(bearer(w.token)).expect(200);
      await features.set(w.client.id, 'compose', true);

      await features.set(w.client.id, 'edit-brand', false);
      await http().put('/brand-profile').set(bearer(w.token)).send({ niche: 'x' }).expect(403);
      await http().get('/brand-profile').set(bearer(w.token)).expect(200);

      await features.set(w.client.id, 'inbox-reply', false);
      expect((await http().post('/comments/reply').set(bearer(w.token)).send({ platform: 'instagram', commentId: 'c', text: 't' }).expect(403)).body.feature).toBe('inbox-reply');
      await http().get('/comments/events').set(bearer(w.token)).expect(200);
    });

    it('unknown switches are refused', async () => {
      await expect(features.set(A.client.id, 'make-coffee', true)).rejects.toThrow('Unknown feature');
      expect(FEATURE_KEYS.length).toBe(Object.keys(FEATURE_DEFAULTS).length);
    });
  });

  // ---------------------------------------------------------------- sign-up

  describe('sign-up', () => {
    it('gives each new sign-up a workspace of their own, never admin rights', async () => {
      const res = await http().post('/auth/register').send({ email: 'tenancy-signup@example.com', password: 'password123' }).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'tenancy-signup@example.com' } });
      made.users.push(user.id);
      if (user.clientId) made.clients.push(user.clientId);
      expect(user.role).not.toBe('ADMIN'); // someone else already exists, so this is not the bootstrap admin
      expect(user.clientId).not.toBeNull();
      expect([A.client.id, B.client.id, adminHome.id]).not.toContain(user.clientId);
      expect((await http().get('/auth/me').set(bearer(res.body.token)).expect(200)).body.features.ai).toBe(true);
      await http().get('/posts').set(bearer(res.body.token, { 'X-Client-Id': A.client.id })).expect(403);
    });

    it('can be closed with ALLOW_SIGNUP=false', async () => {
      process.env.ALLOW_SIGNUP = 'false';
      try {
        await http().post('/auth/register').send({ email: 'tenancy-closed@example.com', password: 'password123' }).expect(403);
        expect(await prisma.user.findUnique({ where: { email: 'tenancy-closed@example.com' } })).toBeNull();
      } finally {
        delete process.env.ALLOW_SIGNUP;
      }
    });
  });

  // ---------------------------------------------------------------- uploads

  describe('uploaded media', () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    it('belongs to the client that uploaded it', async () => {
      const up = await http().post('/media/upload').set(bearer(A.token)).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201);
      const url: string = up.body.url;
      made.files.push(url.split('/').pop() as string);

      await http().post('/drafts').set(bearer(A.token)).send({ mediaUrls: [url] }).expect(201);
      const stolen = await http().post('/drafts').set(bearer(B.token)).send({ mediaUrls: [url] }).expect(400);
      expect(stolen.body.message).toContain('not available');
      await http().post('/posts').set(bearer(B.token)).send({ accountId: B.account.id, platform: 'instagram', mediaUrls: [url], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);
      // An admin acting as A may use A's files; acting as B may not.
      await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': A.client.id })).send({ mediaUrls: [url] }).expect(201);
      await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': B.client.id })).send({ mediaUrls: [url] }).expect(400);
    });

    it('pre-flight checks cannot run on another client\'s file either', async () => {
      const up = await http().post('/media/upload').set(bearer(A.token)).attach('file', png, { filename: 'b.png', contentType: 'image/png' }).expect(201);
      made.files.push(up.body.url.split('/').pop() as string);
      await features.set(B.client.id, 'ai', true);
      const res = await http().post('/preflight').set(bearer(B.token)).send({ mediaUrls: [up.body.url] }).expect(400);
      expect(res.body.message).toContain('not available');
    });

    it('files from before ownership was recorded stay usable', async () => {
      const name = `1000-${'a'.repeat(8)}.png`;
      expect(await prisma.mediaFile.findUnique({ where: { name } })).toBeNull();
      await http().post('/drafts').set(bearer(B.token)).send({ mediaUrls: [`http://localhost:3001/media/${name}`] }).expect(201);
    });
  });

  // ---------------------------------------------------------------- background work

  describe('background work', () => {
    it('the scheduler leaves a suspended client\'s posts alone until it is reactivated', async () => {
      const w = await world('sched');
      const due = await prisma.scheduledPost.create({ data: { accountId: w.account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: '[]', scheduledAt: new Date(Date.now() - 1000), status: 'SCHEDULED' } });
      await prisma.client.update({ where: { id: w.client.id }, data: { status: 'SUSPENDED' } });
      pub.publish.mockClear();
      await app.get(SchedulerService).tick();
      expect(pub.publish).not.toHaveBeenCalledWith(due.id);
      expect(await prisma.scheduledPost.findUnique({ where: { id: due.id } })).toMatchObject({ status: 'SCHEDULED' });

      await prisma.client.update({ where: { id: w.client.id }, data: { status: 'ACTIVE' } });
      await app.get(SchedulerService).tick();
      expect(pub.publish).toHaveBeenCalledWith(due.id);
    });

    it('comments still reach the inbox, but rules only act for active clients with automations on', async () => {
      const w = await world('auto');
      await prisma.automationRule.update({ where: { id: w.rule.id }, data: { replyMode: 'PUBLIC', publicReply: 'Thanks, check your DMs!' } });
      const automations = app.get(AutomationsService);
      const comment = (id: string) => ({ platform: 'instagram', channelId: w.account.externalId, commentId: id, senderId: 'someone', text: 'what is the price?', createdAt: new Date() });

      await features.set(w.client.id, 'automations', false);
      pub.replyInstagramComment.mockClear();
      await automations.handleComment(comment('off-1'));
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();
      expect(await prisma.commentEvent.findFirst({ where: { accountId: w.account.id, commentId: 'off-1' } })).not.toBeNull();

      await features.set(w.client.id, 'automations', true);
      await prisma.client.update({ where: { id: w.client.id }, data: { status: 'SUSPENDED' } });
      await automations.handleComment(comment('paused-1'));
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();

      await prisma.client.update({ where: { id: w.client.id }, data: { status: 'ACTIVE' } });
      await automations.handleComment(comment('on-1'));
      expect(pub.replyInstagramComment).toHaveBeenCalledTimes(1);
    });

    it('a pre-flight check belongs to the client that ran it, and is written in that client brand voice', async () => {
      const w = await world('pre', { ai: true });
      ai.reviewContent.mockClear();
      const created = await http().post('/preflight').set(bearer(w.token)).send({ text: 'A post about our sourdough.' }).expect(201);
      expect(await prisma.contentCheck.findUnique({ where: { id: created.body.id } })).toMatchObject({ clientId: w.client.id, userId: w.user.id });

      let status = '';
      for (let i = 0; i < 100 && status !== 'DONE'; i++) {
        status = (await http().get(`/preflight/${created.body.id}`).set(bearer(w.token)).expect(200)).body.status;
        if (status !== 'DONE') await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe('DONE');
      expect(ai.reviewContent).toHaveBeenCalledTimes(1);
      expect(ai.reviewContent.mock.calls[0][0].brand).toMatchObject({ niche: 'niche pre' }); // this client's profile, nobody else's

      await http().get(`/preflight/${created.body.id}`).set(bearer(B.token)).expect(404);
      await http().get(`/preflight/${created.body.id}`).set(bearer(admin.token, { 'X-Client-Id': w.client.id })).expect(200);
      await http().get(`/preflight/${created.body.id}`).set(bearer(admin.token)).expect(404); // staff's own workspace does not see it
    });

    it('sync only touches the acting client\'s channels', async () => {
      const w = await world('sync');
      const res = await http().post('/analytics/sync').set(bearer(w.token)).expect(202);
      expect(res.body).toEqual({ syncing: true });
    });
  });

  // ---------------------------------------------------------------- moving old data into workspaces

  describe('backfill', () => {
    it('gives every existing user a workspace and moves their data into it, once', async () => {
      const legacyHash = await hashPassword('password123');
      const orphanId = `legacy-orphan-${Date.now()}`;
      made.externalIds.push(orphanId, `legacy-ig-${Date.now()}`);
      const u1 = await prisma.user.create({ data: { email: 'tenancy-legacy1@example.com', passwordHash: legacyHash, role: Role.ADMIN } });
      const u2 = await prisma.user.create({ data: { email: 'tenancy-legacy2@example.com', passwordHash: legacyHash, role: Role.ADMIN } });
      made.users.push(u1.id, u2.id);
      expect(u1.clientId).toBeNull();

      const upload = `${Date.now()}-${'c'.repeat(8)}.jpg`;
      const acc1 = await prisma.socialAccount.create({ data: { userId: u1.id, provider: 'instagram', externalId: made.externalIds[made.externalIds.length - 1], accessToken: encryptToken('t') } });
      const orphan = await prisma.socialAccount.create({ data: { provider: 'threads', externalId: orphanId, accessToken: encryptToken('t') } });
      await prisma.scheduledPost.create({ data: { accountId: acc1.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: JSON.stringify([`https://tunnel.example.dev/media/${upload}`]), scheduledAt: new Date(Date.now() + 86_400_000) } });
      await prisma.postDraft.create({ data: { userId: u1.id, caption: 'old draft' } });
      await prisma.contentIdea.create({ data: { userId: u2.id, title: 'old idea', hook: 'h', format: 'REEL', platform: 'instagram' } });
      await prisma.hook.create({ data: { userId: u2.id, text: 'old hook', category: 'CURIOSITY' } });
      await prisma.contentCheck.create({ data: { userId: u2.id, kind: 'TEXT', platform: 'instagram', text: 't' } });
      await prisma.brandProfile.create({ data: { userId: u2.id, niche: 'old niche' } });

      const backfill = app.get(TenancyBackfillService);
      const first = await backfill.run();
      expect(first.clientsCreated).toBeGreaterThanOrEqual(2);
      expect(first.mediaRecorded).toBeGreaterThanOrEqual(1);

      const [r1, r2] = await Promise.all([u1, u2].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.id } })));
      expect(r1.clientId).not.toBeNull();
      expect(r2.clientId).not.toBeNull();
      expect(r1.clientId).not.toBe(r2.clientId);
      made.clients.push(r1.clientId!, r2.clientId!);

      expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc1.id } })).clientId).toBe(r1.clientId);
      expect((await prisma.postDraft.findFirstOrThrow({ where: { userId: u1.id } })).clientId).toBe(r1.clientId);
      expect((await prisma.contentIdea.findFirstOrThrow({ where: { userId: u2.id } })).clientId).toBe(r2.clientId);
      expect((await prisma.hook.findFirstOrThrow({ where: { userId: u2.id } })).clientId).toBe(r2.clientId);
      expect((await prisma.contentCheck.findFirstOrThrow({ where: { userId: u2.id } })).clientId).toBe(r2.clientId);
      expect((await prisma.brandProfile.findFirstOrThrow({ where: { userId: u2.id } })).clientId).toBe(r2.clientId);
      // Channels from before accounts existed go to the first user's workspace.
      const first_user = await prisma.user.findFirstOrThrow({ where: { clientId: { not: null } }, orderBy: { createdAt: 'asc' } });
      expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: orphan.id } })).clientId).toBe(first_user.clientId);
      // Their uploads are now recorded against their client, and their AI switch stays on as it always was.
      expect(await prisma.mediaFile.findUnique({ where: { name: upload } })).toMatchObject({ clientId: r1.clientId });
      expect((await features.forClient(r1.clientId!)).ai).toBe(true);

      const again = await backfill.run();
      expect(again).toEqual({ clientsCreated: 0, rowsAssigned: 0, mediaRecorded: 0, promoted: 0 });
    });
  });

  describe('who is staff', () => {
    it('is named in ADMIN_EMAILS, never guessed, and never taken away by leaving someone off the list', async () => {
      const u = await makeUser('tenancy-promote@example.com', Role.CLIENT_POC, B.client.id);
      process.env.ADMIN_EMAILS = ' Tenancy-Promote@example.com , someone-else@example.com ';
      try {
        expect((await app.get(TenancyBackfillService).run()).promoted).toBe(1);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).role).toBe('ADMIN');
        await http().get('/posts').set(bearer(u.token, { 'X-Client-Id': A.client.id })).expect(200); // now allowed to act as a client
        expect((await app.get(TenancyBackfillService).run()).promoted).toBe(0); // already done
      } finally {
        delete process.env.ADMIN_EMAILS;
      }
      await app.get(TenancyBackfillService).run();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } })).role).toBe('ADMIN');
    });

    it('existing users stay ordinary users: having signed up first is not a reason to be staff', async () => {
      // A user from before workspaces: no client, and the default role (this is what the migration leaves behind).
      const old = await prisma.user.create({ data: { email: 'tenancy-legacy3@example.com', passwordHash: await hashPassword('password123') } });
      made.users.push(old.id);
      await app.get(TenancyBackfillService).run();
      const after = await prisma.user.findUniqueOrThrow({ where: { id: old.id } });
      expect(after.role).toBe('CLIENT_POC');
      expect(after.clientId).not.toBeNull(); // but they do get a workspace of their own, so nothing they had disappears
      made.clients.push(after.clientId!);
      await http().get('/posts').set(bearer(signToken(old.id, 'session', 3600), { 'X-Client-Id': A.client.id })).expect(403);
    });
  });

  // ---------------------------------------------------------------- every route is accounted for

  describe('routes', () => {
    // Anything not listed here fails the test below, so adding a route means deciding how it is scoped.
    const TENANT = [
      'GET /accounts', 'POST /accounts', 'DELETE /accounts/:id',
      'GET /posts', 'POST /posts', 'PATCH /posts/:id', 'DELETE /posts/:id',
      'GET /drafts', 'POST /drafts', 'PATCH /drafts/:id', 'DELETE /drafts/:id',
      'GET /ideas', 'POST /ideas/generate', 'PATCH /ideas/:id', 'DELETE /ideas/:id',
      'GET /hooks', 'POST /hooks', 'POST /hooks/generate', 'PATCH /hooks/:id/favorite', 'POST /hooks/:id/use', 'DELETE /hooks/:id',
      'GET /brand-profile', 'PUT /brand-profile',
      'GET /comments/events', 'POST /comments/reply',
      'GET /automations', 'POST /automations', 'PATCH /automations/:id/toggle', 'DELETE /automations/:id',
      'GET /preflight', 'POST /preflight', 'POST /preflight/compare', 'GET /preflight/groups/:groupId', 'GET /preflight/:id', 'GET /preflight/:id/brain', 'POST /preflight/:id/brain', 'POST /preflight/:id/retry', 'DELETE /preflight/:id',
      'GET /dashboard', 'GET /analytics', 'POST /analytics/sync',
      'POST /media/upload', 'GET /auth/:provider/start',
    ];
    // Signed in, but about the app or the caller rather than any client's data.
    const SESSION = ['GET /auth/me', 'GET /ai/status', 'GET /preflight/status', 'POST /auth/exchange'];
    // Open to anyone: sign-in, Meta's redirects and webhooks (verified by signature).
    const PUBLIC = ['POST /auth/login', 'POST /auth/register', 'GET /auth/facebook/callback', 'GET /auth/instagram/callback', 'GET /auth/threads/callback', 'GET /webhooks/meta', 'POST /webhooks/meta'];

    it('every route is classified, so no route can skip the scoping decision', () => {
      const stack = (app.getHttpAdapter().getInstance() as any)._router.stack as any[];
      const routes = stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`));
      const known = new Set([...TENANT, ...SESSION, ...PUBLIC]);
      expect(routes.filter((r) => !known.has(r))).toEqual([]);
      expect([...known].filter((r) => !routes.includes(r))).toEqual([]); // and nothing listed here has quietly gone away
    });

    it('nothing but the public routes answers without a session', async () => {
      for (const route of [...TENANT, ...SESSION]) {
        const [method, path] = route.split(' ');
        const url = path.replace(':provider', 'instagram').replace(/:[a-zA-Z]+/g, 'x');
        await (http() as any)[method.toLowerCase()](url).expect(401);
      }
    });
  });

  it('keeps the existing defaults: sections on, AI off', () => {
    expect(Object.entries(FEATURE_DEFAULTS).filter(([, on]) => !on).map(([k]) => k)).toEqual(['ai']);
    expect(existsSync(UPLOAD_DIR)).toBe(true);
  });
});
