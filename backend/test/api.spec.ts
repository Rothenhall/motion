import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { MetaService } from '../src/meta.service';
import { AutomationsService } from '../src/automations.service';
import { SchedulerService } from '../src/scheduler.service';
import { decryptToken, isEncryptedToken, signToken } from '../src/auth/crypto';

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('API security', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const pub = { replyInstagramComment: jest.fn(), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn(), publish: jest.fn() };
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const register = async (email: string) => (await http().post('/auth/register').send({ email, password: 'password123' }).expect(201)).body.token as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // A channel connected before user accounts existed, still holding a plaintext token.
    await prisma.socialAccount.create({ data: { provider: 'instagram', externalId: 'legacy-ig', accessToken: 'legacy-plain-token' } });
    await app.get(MetaService).onModuleInit();

    alice = await register('alice@example.com');
    bob = await register('bob@example.com');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('hardening', () => {
    it('sends security headers, lets other origins display uploaded media, and hides the framework', async () => {
      const res = await http().get('/auth/me').expect(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('slows down repeated sign-in attempts but not the webhook', async () => {
      process.env.RATE_LIMIT = 'on';
      try {
        const attempt = () => http().post('/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
        for (let i = 0; i < 10; i++) await attempt().expect(401);
        const blocked = await attempt().expect(429);
        expect(blocked.body.message).toMatch(/too many/i);
        // Meta's webhook is exempt: it is verified by signature and may burst.
        for (let i = 0; i < 12; i++) await http().get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' }).expect(403);
      } finally {
        process.env.RATE_LIMIT = 'off';
      }
    });
  });

  describe('protected routes reject unauthenticated calls', () => {
    const routes: [string, string][] = [
      ['get', '/accounts'], ['post', '/accounts'], ['delete', '/accounts/x'],
      ['get', '/posts'], ['post', '/posts'], ['delete', '/posts/x'], ['get', '/drafts'], ['post', '/drafts'], ['patch', '/drafts/x'], ['delete', '/drafts/x'],
      ['get', '/automations'], ['post', '/automations'], ['patch', '/automations/x/toggle'], ['delete', '/automations/x'],
      ['get', '/comments/events'], ['post', '/comments/reply'],
      ['get', '/dashboard'], ['post', '/media/upload'],
      ['get', '/analytics'], ['post', '/analytics/sync'],
      ['get', '/brand-profile'], ['put', '/brand-profile'], ['get', '/ideas'], ['post', '/ideas/generate'], ['patch', '/ideas/x'], ['delete', '/ideas/x'],
      ['get', '/hooks'], ['post', '/hooks'], ['post', '/hooks/generate'], ['patch', '/hooks/x/favorite'], ['post', '/hooks/x/use'], ['delete', '/hooks/x'],
      ['get', '/preflight'], ['post', '/preflight'], ['get', '/preflight/status'], ['post', '/preflight/compare'], ['get', '/preflight/x'],
      ['get', '/preflight/groups/x'], ['post', '/preflight/x/retry'], ['delete', '/preflight/x'],
      ['get', '/auth/me'], ['get', '/auth/instagram/start'], ['post', '/auth/exchange'],
    ];

    it.each(routes)('%s %s without a token -> 401', async (method, path) => {
      await (http() as any)[method](path).expect(401);
    });

    it.each(routes)('%s %s with a forged or wrong-type token -> 401', async (method, path) => {
      await (http() as any)[method](path).set('Authorization', 'Bearer abc.def.ghi').expect(401);
      await (http() as any)[method](path).set('Authorization', `Bearer ${signToken('someone', 'oauth_state', 60)}`).expect(401);
    });

    it('rejects a valid token for a user that no longer exists', async () => {
      await http().get('/accounts').set('Authorization', `Bearer ${signToken('deleted-user', 'session', 60)}`).expect(401);
    });
  });

  describe('user accounts', () => {
    it('logs in with the right password only', async () => {
      const ok = await http().post('/auth/login').send({ email: 'ALICE@example.com', password: 'password123' }).expect(200);
      await http().get('/auth/me').set('Authorization', `Bearer ${ok.body.token}`).expect(200, { id: ok.body.user.id, email: 'alice@example.com' });
      await http().post('/auth/login').send({ email: 'alice@example.com', password: 'nope-nope' }).expect(401);
      await http().post('/auth/login').send({ email: 'nobody@example.com', password: 'password123' }).expect(401);
    });

    it('validates registration and refuses duplicates', async () => {
      await http().post('/auth/register').send({ email: 'x@example.com', password: 'short' }).expect(400);
      await http().post('/auth/register').send({ email: 'not-an-email', password: 'password123' }).expect(400);
      await http().post('/auth/register').send({ email: 'alice@example.com', password: 'password123' }).expect(409);
    });

    it('gives pre-existing channels to the first user', async () => {
      const res = await http().get('/accounts').set('Authorization', `Bearer ${alice}`).expect(200);
      expect(res.body.map((a: any) => a.externalId)).toEqual(['legacy-ig']);
      expect((await http().get('/accounts').set('Authorization', `Bearer ${bob}`).expect(200)).body).toEqual([]);
    });
  });

  describe('data is scoped to its owner', () => {
    let bobAccount: string;

    beforeAll(async () => {
      bobAccount = (await http().post('/accounts').set('Authorization', `Bearer ${bob}`)
        .send({ provider: 'instagram', externalId: 'ig-bob', name: '@bob', accessToken: 'bob-secret-token' }).expect(201)).body.id;
    });

    it('never returns the access token from the API', async () => {
      const res = await http().get('/accounts').set('Authorization', `Bearer ${bob}`).expect(200);
      expect(JSON.stringify(res.body)).not.toContain('accessToken');
    });

    it('stops one user from touching another user\'s channel', async () => {
      await http().post('/posts').set('Authorization', `Bearer ${alice}`)
        .send({ accountId: bobAccount, platform: 'instagram', mediaUrls: [], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);
      await http().post('/automations').set('Authorization', `Bearer ${alice}`).send({ accountId: bobAccount, name: 'steal', trigger: 'ALL_COMMENTS' }).expect(400);
      await http().post('/comments/reply').set('Authorization', `Bearer ${alice}`).send({ platform: 'instagram', commentId: 'c', text: 'hi', accountId: bobAccount }).expect(400);
      await http().delete(`/accounts/${bobAccount}`).set('Authorization', `Bearer ${alice}`).expect(404);
      expect(pub.privateReplyInstagram).not.toHaveBeenCalled();
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();
    });

    it('hides another user\'s posts and rules', async () => {
      const post = await http().post('/posts').set('Authorization', `Bearer ${bob}`)
        .send({ accountId: bobAccount, platform: 'instagram', mediaUrls: [], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(201);
      const rule = await http().post('/automations').set('Authorization', `Bearer ${bob}`)
        .send({ accountId: bobAccount, name: 'hello', trigger: 'ALL_COMMENTS', replyMode: 'PUBLIC', publicReply: 'thanks!' }).expect(201);

      expect((await http().get('/posts').set('Authorization', `Bearer ${alice}`).expect(200)).body).toEqual([]);
      expect((await http().get('/automations').set('Authorization', `Bearer ${alice}`).expect(200)).body).toEqual([]);
      await http().delete(`/posts/${post.body.id}`).set('Authorization', `Bearer ${alice}`).expect(404);
      await http().patch(`/automations/${rule.body.id}/toggle`).set('Authorization', `Bearer ${alice}`).expect(404);
      await http().delete(`/automations/${rule.body.id}`).set('Authorization', `Bearer ${alice}`).expect(404);

      const dash = await http().get('/dashboard').set('Authorization', `Bearer ${alice}`).expect(200);
      expect(dash.body.stats.scheduled).toBe(0);
      expect(dash.body.automationCount).toBe(0);
      expect((await http().get('/dashboard').set('Authorization', `Bearer ${bob}`).expect(200)).body.stats.scheduled).toBe(1);
    });

    it('keeps analytics to the owner\'s channels', async () => {
      const yesterday = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - 86_400_000);
      await prisma.accountInsight.createMany({ data: [
        { accountId: bobAccount, date: yesterday, metric: 'views', value: 500 },
        { accountId: bobAccount, date: yesterday, metric: 'followers', value: 42 },
      ] });

      const mine = (await http().get('/analytics?days=7').set('Authorization', `Bearer ${bob}`).expect(200)).body;
      expect(mine.totals.views).toBe(500);
      expect(mine.totals.followers).toBe(42);
      expect(mine.channels.map((c: any) => c.accountId)).toEqual([bobAccount]);

      const theirs = (await http().get('/analytics?days=7').set('Authorization', `Bearer ${alice}`).expect(200)).body;
      expect(theirs.totals.views).toBe(0);
      expect(theirs.totals.followers).toBeNull();
      expect(theirs.channels.map((c: any) => c.accountId)).not.toContain(bobAccount);
    });
  });

  describe('AI ideas and hooks are scoped to their owner', () => {
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('keeps brand profiles separate', async () => {
      await http().put('/brand-profile').set(auth(bob)).send({ niche: 'Coffee roasting', platforms: ['instagram'] }).expect(200);
      expect((await http().get('/brand-profile').set(auth(bob)).expect(200)).body.niche).toBe('Coffee roasting');
      expect((await http().get('/brand-profile').set(auth(alice)).expect(200)).body).toEqual({});
    });

    it('hides and protects another user\'s ideas', async () => {
      const bobUser = (await http().get('/auth/me').set(auth(bob)).expect(200)).body.id;
      const idea = await prisma.contentIdea.create({ data: { userId: bobUser, title: 'Bob idea', hook: 'h', format: 'REEL', platform: 'instagram' } });
      expect((await http().get('/ideas').set(auth(bob)).expect(200)).body.map((i: any) => i.id)).toEqual([idea.id]);
      expect((await http().get('/ideas').set(auth(alice)).expect(200)).body).toEqual([]);
      await http().patch(`/ideas/${idea.id}`).set(auth(alice)).send({ status: 'SAVED' }).expect(404);
      await http().delete(`/ideas/${idea.id}`).set(auth(alice)).expect(204);
      expect(await prisma.contentIdea.findUnique({ where: { id: idea.id } })).not.toBeNull();
    });

    it('gives each user their own starter hooks and favorites', async () => {
      const [a, b] = await Promise.all([
        http().get('/hooks').set(auth(alice)).expect(200),
        http().get('/hooks').set(auth(bob)).expect(200),
      ]);
      expect(a.body.length).toBeGreaterThan(0);
      expect(b.body.length).toBe(a.body.length);
      // A second load doesn't seed again.
      expect((await http().get('/hooks').set(auth(alice)).expect(200)).body.length).toBe(a.body.length);

      const bobHook = b.body[0].id;
      await http().patch(`/hooks/${bobHook}/favorite`).set(auth(alice)).expect(404);
      await http().post(`/hooks/${bobHook}/use`).set(auth(alice)).expect(404);
      await http().patch(`/hooks/${bobHook}/favorite`).set(auth(bob)).expect(200);
      expect((await http().get('/hooks?favorites=true').set(auth(alice)).expect(200)).body).toEqual([]);

      const custom = await http().post('/hooks').set(auth(alice)).send({ text: 'Alice only hook' }).expect(201);
      expect((await http().get('/hooks?q=alice only').set(auth(bob)).expect(200)).body).toEqual([]);
      expect((await http().get('/hooks?q=alice only').set(auth(alice)).expect(200)).body.map((h: any) => h.id)).toEqual([custom.body.id]);
    });
  });

  describe('access tokens at rest', () => {
    it('stores new tokens encrypted', async () => {
      const row = await prisma.socialAccount.findFirstOrThrow({ where: { externalId: 'ig-bob' } });
      expect(isEncryptedToken(row.accessToken)).toBe(true);
      expect(row.accessToken).not.toContain('bob-secret-token');
      expect(decryptToken(row.accessToken)).toBe('bob-secret-token');
    });

    it('encrypts legacy plaintext tokens at boot', async () => {
      const row = await prisma.socialAccount.findFirstOrThrow({ where: { externalId: 'legacy-ig' } });
      expect(isEncryptedToken(row.accessToken)).toBe(true);
      expect(decryptToken(row.accessToken)).toBe('legacy-plain-token');
    });
  });

  describe('Meta OAuth', () => {
    it('hands back an authorize URL carrying signed state', async () => {
      const res = await http().get('/auth/instagram/start').set('Authorization', `Bearer ${alice}`).expect(200);
      expect(new URL(res.body.url).searchParams.get('state')).toBeTruthy();
    });

    it('sends Threads login to threads.net with the Threads app ID', async () => {
      await http().get('/auth/threads/start').set('Authorization', `Bearer ${alice}`).expect(400);
      process.env.META_THREADS_APP_ID = 'threads-app-id';
      process.env.META_THREADS_APP_SECRET = 'threads-secret';
      try {
        const url = new URL((await http().get('/auth/threads/start').set('Authorization', `Bearer ${alice}`).expect(200)).body.url);
        expect(url.origin + url.pathname).toBe('https://threads.net/oauth/authorize');
        expect(url.searchParams.get('client_id')).toBe('threads-app-id');
      } finally {
        delete process.env.META_THREADS_APP_ID;
        delete process.env.META_THREADS_APP_SECRET;
      }
    });

    it('asks Facebook for the permissions comment replies and webhooks need', async () => {
      const url = new URL((await http().get('/auth/facebook/start').set('Authorization', `Bearer ${alice}`).expect(200)).body.url);
      expect(url.searchParams.get('scope')!.split(',')).toEqual(expect.arrayContaining(['pages_manage_engagement', 'pages_manage_metadata', 'pages_messaging']));
    });

    it('refuses callbacks without valid state', async () => {
      for (const q of ['code=abc', 'code=abc&state=forged', `code=abc&state=${signToken('u', 'oauth_state', 60, { provider: 'facebook' })}`]) {
        const res = await http().get(`/auth/instagram/callback?${q}`).expect(302);
        expect(res.headers.location).toContain('error=');
      }
    });
  });

  describe('Meta webhooks', () => {
    const payload = JSON.stringify({
      object: 'instagram',
      entry: [{ id: 'ig-bob', changes: [{ field: 'comments', value: { id: 'comment-1', text: 'love it', media: { id: 'm1' }, from: { id: 'fan' } } }] }],
    });

    it('stays public for the subscription handshake', async () => {
      await http().get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '42' }).expect(200, '42');
      await http().get('/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '42' }).expect(403);
    });

    it('rejects unsigned and badly signed deliveries without acting on them', async () => {
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').send(payload).expect(401);
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(payload, 'attacker')).send(payload).expect(401);
      // Signed over different bytes than were sent.
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(payload + ' ', 'test-app-secret')).send(payload).expect(401);
      expect(await prisma.commentEvent.count()).toBe(0);
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();
    });

    const deliver = async (body: unknown, secret = 'test-ig-app-secret') => {
      const raw = JSON.stringify(body);
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw, secret)).send(raw).expect(200);
      await app.get(AutomationsService).idle();
    };
    const igComment = (id: string, from: Record<string, string>, text = 'hello') => ({
      object: 'instagram',
      entry: [{ id: 'ig-bob', time: Math.floor(Date.now() / 1000), changes: [{ field: 'comments', value: { id, text, media: { id: 'm1' }, from } }] }],
    });

    it('runs only the matching channel\'s automations for a signed delivery', async () => {
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(payload, 'test-ig-app-secret')).send(payload).expect(200);
      await app.get(AutomationsService).idle();
      expect(pub.replyInstagramComment).toHaveBeenCalledWith('comment-1', 'thanks!', 'bob-secret-token');

      const bobEvents = (await http().get('/comments/events').set('Authorization', `Bearer ${bob}`).expect(200)).body;
      expect(bobEvents.map((e: any) => e.commentId)).toEqual(['comment-1']);
      expect((await http().get('/comments/events').set('Authorization', `Bearer ${alice}`).expect(200)).body).toEqual([]);
    });

    it('replies once when Meta delivers the same comment again', async () => {
      pub.replyInstagramComment.mockClear();
      await deliver(JSON.parse(payload));
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();
    });

    it('never replies to the account\'s own comments or to its own replies', async () => {
      pub.replyInstagramComment.mockClear();
      await deliver(igComment('own-1', { id: 'ig-bob' }));
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();

      pub.replyInstagramComment.mockResolvedValueOnce('reply-1');
      await deliver(igComment('fan-2', { id: 'fan' }));
      expect(pub.replyInstagramComment).toHaveBeenCalledTimes(1);
      // The webhook for Motion's own reply, even with an unfamiliar sender id.
      await deliver(igComment('reply-1', { id: 'some-scoped-id' }));
      expect(pub.replyInstagramComment).toHaveBeenCalledTimes(1);
    });

    describe('Facebook Page comments', () => {
      const feed = (commentId: string, verb: string, extra: Record<string, unknown> = {}) => ({
        object: 'page',
        entry: [{ id: 'page-bob', time: Math.floor(Date.now() / 1000), changes: [{ field: 'feed', value: { item: 'comment', verb, comment_id: commentId, post_id: 'p1', from: { id: 'fan', name: 'Fan' }, message: 'price?', created_time: Math.floor(Date.now() / 1000), ...extra } }] }],
      });

      beforeAll(async () => {
        const page = (await http().post('/accounts').set('Authorization', `Bearer ${bob}`)
          .send({ provider: 'facebook_page', externalId: 'page-bob', name: 'Bob Page', accessToken: 'bob-page-token' }).expect(201)).body.id;
        await http().post('/automations').set('Authorization', `Bearer ${bob}`)
          .send({ accountId: page, name: 'price', trigger: 'COMMENT_KEYWORD', keyword: 'price', replyMode: 'PUBLIC_AND_DM', publicReply: 'Sent you a DM', dmText: 'Here is the price' }).expect(201);
      });

      it('replies and sends a private reply for a new comment', async () => {
        await deliver(feed('fb-c1', 'add'), 'test-app-secret');
        expect(pub.replyFacebookComment).toHaveBeenCalledWith('fb-c1', 'Sent you a DM', 'bob-page-token');
        expect(pub.privateReplyFacebook).toHaveBeenCalledWith('page-bob', 'fb-c1', 'Here is the price', 'bob-page-token');
      });

      it('ignores edits, removals and the Page\'s own comments', async () => {
        pub.replyFacebookComment.mockClear();
        pub.privateReplyFacebook.mockClear();
        await deliver(feed('fb-c2', 'edited'), 'test-app-secret');
        await deliver(feed('fb-c3', 'remove'), 'test-app-secret');
        await deliver(feed('fb-c4', 'add', { from: { id: 'page-bob', name: 'Bob Page' } }), 'test-app-secret');
        expect(pub.replyFacebookComment).not.toHaveBeenCalled();
        expect(pub.privateReplyFacebook).not.toHaveBeenCalled();
      });

      it('skips the private reply for comments older than 7 days', async () => {
        pub.replyFacebookComment.mockClear();
        pub.privateReplyFacebook.mockClear();
        await deliver(feed('fb-old', 'add', { created_time: Math.floor(Date.now() / 1000) - 8 * 86_400 }), 'test-app-secret');
        expect(pub.replyFacebookComment).toHaveBeenCalledTimes(1);
        expect(pub.privateReplyFacebook).not.toHaveBeenCalled();
      });
    });
  });

  describe('drafts', () => {
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('saves a half-written post and updates it in place', async () => {
      const created = await http().post('/drafts').set(auth(alice)).send({ caption: 'just a thought' }).expect(201);
      expect(created.body).toMatchObject({ caption: 'just a thought', mediaType: 'IMAGE', accountId: null, scheduledAt: null });
      const updated = await http().patch(`/drafts/${created.body.id}`).set(auth(alice)).send({ caption: 'a better thought', mediaUrls: ['https://cdn.example.com/a.jpg'] }).expect(200);
      expect(updated.body.id).toBe(created.body.id);
      expect(JSON.parse(updated.body.mediaUrls)).toEqual(['https://cdn.example.com/a.jpg']);
      const list = (await http().get('/drafts').set(auth(alice)).expect(200)).body;
      expect(list.filter((d: any) => d.id === created.body.id)).toHaveLength(1);
    });

    it('keeps drafts private to their owner', async () => {
      const mine = (await http().post('/drafts').set(auth(alice)).send({ caption: 'private' }).expect(201)).body;
      expect((await http().get('/drafts').set(auth(bob)).expect(200)).body.some((d: any) => d.id === mine.id)).toBe(false);
      await http().patch(`/drafts/${mine.id}`).set(auth(bob)).send({ caption: 'hijacked' }).expect(404);
      await http().delete(`/drafts/${mine.id}`).set(auth(bob)).expect(404);
      expect((await prisma.postDraft.findUniqueOrThrow({ where: { id: mine.id } })).caption).toBe('private');
    });

    it('rejects a channel that is not theirs, bad media and unknown formats', async () => {
      const bobAcc = (await http().get('/accounts').set(auth(bob)).expect(200)).body[0].id;
      await http().post('/drafts').set(auth(alice)).send({ accountId: bobAcc }).expect(400);
      await http().post('/drafts').set(auth(alice)).send({ mediaUrls: 'not-a-list' }).expect(400);
      await http().post('/drafts').set(auth(alice)).send({ mediaType: 'HOLOGRAM' }).expect(400);
      await http().post('/drafts').set(auth(alice)).send({ platform: 'myspace' }).expect(400);
    });

    it('limits media per draft and how many drafts one person can keep', async () => {
      const many = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
      expect((await http().post('/drafts').set(auth(alice)).send({ mediaUrls: many }).expect(400)).body.message).toContain('at most 10');
      await http().post('/drafts').set(auth(alice)).send({ mediaUrls: ['https://cdn.example.com/' + 'x'.repeat(2100)] }).expect(400);

      const carol = await register('carol@example.com');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'carol@example.com' } });
      await prisma.postDraft.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ userId: user.id, caption: `d${i}` })) });
      expect((await http().post('/drafts').set(auth(carol)).send({ caption: 'one too many' }).expect(400)).body.message).toContain('100 drafts');
      await http().patch(`/drafts/${(await prisma.postDraft.findFirstOrThrow({ where: { userId: user.id } })).id}`).set(auth(carol)).send({ caption: 'still editable' }).expect(200);
    });

    it('is consumed when the post is scheduled, and a foreign draft id is left alone', async () => {
      const account = (await http().get('/accounts').set(auth(bob)).expect(200)).body.find((a: any) => a.provider === 'instagram').id;
      const bobDraft = (await http().post('/drafts').set(auth(bob)).send({ caption: 'ready' }).expect(201)).body;
      const aliceDraft = (await http().post('/drafts').set(auth(alice)).send({ caption: 'not yours' }).expect(201)).body;
      const body = { accountId: account, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: new Date(Date.now() + 3_600_000).toISOString() };
      await http().post('/posts').set(auth(bob)).send({ ...body, draftId: bobDraft.id }).expect(201);
      await http().post('/posts').set(auth(bob)).send({ ...body, draftId: aliceDraft.id }).expect(201);
      expect(await prisma.postDraft.findUnique({ where: { id: bobDraft.id } })).toBeNull();
      expect(await prisma.postDraft.findUnique({ where: { id: aliceDraft.id } })).not.toBeNull();
    });
  });

  describe('inbox', () => {
    const bobIg = () => prisma.socialAccount.findFirstOrThrow({ where: { externalId: 'ig-bob' } });

    it('attaches the post a comment was left on, when we published it', async () => {
      const account = await bobIg();
      const post = await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'Context post', mediaUrls: '["https://cdn.example.com/a.jpg"]', scheduledAt: new Date(Date.now() - 86_400_000), status: 'PUBLISHED', externalId: 'ig-media-42' } });
      await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'instagram', commentId: 'ctx-1', mediaId: 'ig-media-42', senderId: 'fan', text: 'Love this' } });
      await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'instagram', commentId: 'ctx-2', mediaId: 'someone-elses-media', senderId: 'fan2', text: 'Unknown post' } });
      const events = (await http().get('/comments/events').set('Authorization', `Bearer ${bob}`).expect(200)).body;
      expect(events.find((e: any) => e.commentId === 'ctx-1').post).toMatchObject({ id: post.id, caption: 'Context post' });
      expect(events.find((e: any) => e.commentId === 'ctx-2').post).toBeNull();
    });

    it('matches a Facebook comment whose post id is page_post to a post stored by its short id', async () => {
      const account = await prisma.socialAccount.findFirstOrThrow({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } })).id, provider: 'facebook_page' } }).catch(() => null);
      if (!account) return; // this suite gives bob no Facebook Page
      const post = await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'facebook', mediaType: 'TEXT', caption: 'FB post', mediaUrls: '[]', scheduledAt: new Date(Date.now() - 3_600_000), status: 'PUBLISHED', externalId: '9988' } });
      await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'facebook', commentId: 'fb-ctx', mediaId: `${account.externalId}_9988`, text: 'hi' } });
      const events = (await http().get('/comments/events').set('Authorization', `Bearer ${bob}`).expect(200)).body;
      expect(events.find((e: any) => e.commentId === 'fb-ctx').post.id).toBe(post.id);
    });

    it('marks the comment replied once Meta accepts the reply, and not before', async () => {
      const account = await bobIg();
      await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'instagram', commentId: 'rep-ok', text: 'answer me' } });
      await prisma.commentEvent.create({ data: { accountId: account.id, platform: 'instagram', commentId: 'rep-fail', text: 'answer me too' } });

      pub.replyInstagramComment.mockResolvedValueOnce({ id: 'r1' });
      await http().post('/comments/reply').set('Authorization', `Bearer ${bob}`).send({ platform: 'instagram', commentId: 'rep-ok', text: 'thanks', accountId: account.id }).expect(201);
      expect((await prisma.commentEvent.findFirstOrThrow({ where: { commentId: 'rep-ok' } })).replied).toBe(true);

      pub.privateReplyInstagram.mockResolvedValueOnce({ ok: true });
      await http().post('/comments/reply').set('Authorization', `Bearer ${bob}`).send({ platform: 'instagram', commentId: 'rep-ok', text: 'dm', accountId: account.id, dm: true }).expect(201);
      expect((await prisma.commentEvent.findFirstOrThrow({ where: { commentId: 'rep-ok' } })).dmSent).toBe(true);

      pub.replyInstagramComment.mockRejectedValueOnce(new Error('Meta refused'));
      const failed = await http().post('/comments/reply').set('Authorization', `Bearer ${bob}`).send({ platform: 'instagram', commentId: 'rep-fail', text: 'nope', accountId: account.id });
      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect((await prisma.commentEvent.findFirstOrThrow({ where: { commentId: 'rep-fail' } })).replied).toBe(false);
    });
  });

  describe('scheduling', () => {
    it('rejects posts for a channel the account can\'t publish to, and non-JPEG images for Instagram', async () => {
      const igAccount = (await http().get('/accounts').set('Authorization', `Bearer ${bob}`).expect(200)).body.find((a: any) => a.provider === 'instagram').id;
      const at = new Date(Date.now() + 3_600_000).toISOString();
      await http().post('/posts').set('Authorization', `Bearer ${bob}`).send({ accountId: igAccount, platform: 'threads', mediaUrls: [], scheduledAt: at }).expect(400);
      const png = await http().post('/posts').set('Authorization', `Bearer ${bob}`).send({ accountId: igAccount, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.png'], scheduledAt: at }).expect(400);
      expect(png.body.message).toContain('JPEG');
      await http().post('/posts').set('Authorization', `Bearer ${bob}`).send({ accountId: igAccount, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: at }).expect(201);
    });

    describe('editing a scheduled post in place', () => {
      const igAccountFor = async (token: string) => (await http().get('/accounts').set('Authorization', `Bearer ${token}`).expect(200)).body.find((a: any) => a.provider === 'instagram').id as string;
      // Look the account up first: awaiting inside a half-built request would close supertest's shared server.
      const create = async (token: string, extra: object = {}) => { const accountId = await igAccountFor(token); return (await http().post('/posts').set('Authorization', `Bearer ${token}`)
        .send({ accountId, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], caption: 'first', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), ...extra }).expect(201)).body; };

      it('changes the time and caption but keeps the same post', async () => {
        const post = await create(bob);
        const later = new Date(Date.now() + 7_200_000).toISOString();
        const res = await http().patch(`/posts/${post.id}`).set('Authorization', `Bearer ${bob}`).send({ scheduledAt: later, caption: 'edited' }).expect(200);
        expect(res.body.id).toBe(post.id);
        expect(res.body.caption).toBe('edited');
        expect(new Date(res.body.scheduledAt).toISOString()).toBe(later);
      });

      it('refuses past times, empty edits, bad media and other people\'s posts', async () => {
        const post = await create(bob);
        const patch = (token: string, body: object) => http().patch(`/posts/${post.id}`).set('Authorization', `Bearer ${token}`).send(body);
        expect((await patch(bob, { scheduledAt: new Date(Date.now() - 60_000).toISOString() }).expect(400)).body.message).toContain('future');
        await patch(bob, {}).expect(400);
        expect((await patch(bob, { mediaUrls: ['https://cdn.example.com/a.png'] }).expect(400)).body.message).toContain('JPEG');
        await patch(alice, { caption: 'mine now' }).expect(404);
        expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).caption).toBe('first');
      });

      it('limits media on a new post and on an edit, the same as on a draft', async () => {
        const accountId = await igAccountFor(bob);
        const many = Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
        const when = new Date(Date.now() + 3_600_000).toISOString();
        const res = await http().post('/posts').set('Authorization', `Bearer ${bob}`).send({ accountId, platform: 'instagram', mediaType: 'CAROUSEL', mediaUrls: many, scheduledAt: when }).expect(400);
        expect(res.body.message).toContain('at most 10');
        const post = await create(bob);
        await http().patch(`/posts/${post.id}`).set('Authorization', `Bearer ${bob}`).send({ mediaUrls: many }).expect(400);
      });

      it('only edits posts that are still waiting to publish', async () => {
        const post = await create(bob);
        await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'PUBLISHED' } });
        await http().patch(`/posts/${post.id}`).set('Authorization', `Bearer ${bob}`).send({ caption: 'too late' }).expect(400);
      });
    });

    describe('linking a post to its idea', () => {
      it('marks the idea used and returns it with the post', async () => {
        const bobUser = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
        const idea = await prisma.contentIdea.create({ data: { userId: bobUser.id, title: 'Linked idea', hook: 'A hook', format: 'IMAGE', platform: 'instagram' } });
        const account = (await http().get('/accounts').set('Authorization', `Bearer ${bob}`).expect(200)).body.find((a: any) => a.provider === 'instagram').id;
        const res = await http().post('/posts').set('Authorization', `Bearer ${bob}`)
          .send({ accountId: account, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), ideaId: idea.id }).expect(201);
        expect(res.body.idea).toEqual({ id: idea.id, title: 'Linked idea' });
        expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: idea.id } })).status).toBe('USED');
        expect((await http().get('/posts').set('Authorization', `Bearer ${bob}`).expect(200)).body.find((p: any) => p.id === res.body.id).idea.title).toBe('Linked idea');
      });

      it('ignores an idea that belongs to someone else', async () => {
        const bobUser = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
        const theirs = await prisma.contentIdea.create({ data: { userId: bobUser.id, title: 'Bob only', hook: 'h', format: 'IMAGE', platform: 'instagram' } });
        const account = (await http().get('/accounts').set('Authorization', `Bearer ${alice}`).expect(200)).body.find((a: any) => a.provider === 'instagram');
        if (!account) return; // alice has no Instagram channel in this suite
        const res = await http().post('/posts').set('Authorization', `Bearer ${alice}`)
          .send({ accountId: account.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), ideaId: theirs.id }).expect(201);
        expect(res.body.idea).toBeNull();
        expect((await prisma.contentIdea.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('NEW');
      });
    });

    it('claims each due post so overlapping ticks publish it once', async () => {
      const account = await prisma.socialAccount.findFirstOrThrow({ where: { externalId: 'ig-bob' } });
      await prisma.scheduledPost.updateMany({ where: { status: 'SCHEDULED' }, data: { status: 'FAILED' } });
      const post = await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: '[]', scheduledAt: new Date(Date.now() - 1000) } });
      pub.publish.mockClear();
      const scheduler = app.get(SchedulerService);
      await Promise.all([scheduler.tick(), scheduler.tick(), scheduler.tick()]);
      expect(pub.publish).toHaveBeenCalledTimes(1);
      expect(pub.publish).toHaveBeenCalledWith(post.id);
      expect((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('PUBLISHING');
    });
  });
});
