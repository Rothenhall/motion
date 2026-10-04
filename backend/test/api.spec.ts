import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { MetaService } from '../src/meta.service';
import { decryptToken, isEncryptedToken, signToken } from '../src/auth/crypto';

const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('API security', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const pub = { replyInstagramComment: jest.fn(), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), publish: jest.fn() };
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());
  const register = async (email: string) => (await http().post('/auth/register').send({ email, password: 'password123' }).expect(201)).body.token as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
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

  describe('protected routes reject unauthenticated calls', () => {
    const routes: [string, string][] = [
      ['get', '/accounts'], ['post', '/accounts'], ['delete', '/accounts/x'],
      ['get', '/posts'], ['post', '/posts'], ['delete', '/posts/x'],
      ['get', '/automations'], ['post', '/automations'], ['patch', '/automations/x/toggle'], ['delete', '/automations/x'],
      ['get', '/comments/events'], ['post', '/comments/reply'],
      ['get', '/dashboard'], ['post', '/media/upload'],
      ['get', '/analytics'], ['post', '/analytics/sync'],
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

    it('runs only the matching channel\'s automations for a signed delivery', async () => {
      await http().post('/webhooks/meta').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(payload, 'test-ig-app-secret')).send(payload).expect(201);
      expect(pub.replyInstagramComment).toHaveBeenCalledWith('comment-1', 'thanks!', 'bob-secret-token');

      const bobEvents = (await http().get('/comments/events').set('Authorization', `Bearer ${bob}`).expect(200)).body;
      expect(bobEvents.map((e: any) => e.commentId)).toEqual(['comment-1']);
      expect((await http().get('/comments/events').set('Authorization', `Bearer ${alice}`).expect(200)).body).toEqual([]);
    });
  });
});
