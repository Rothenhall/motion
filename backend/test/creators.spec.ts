import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { AiService } from '../src/ai/ai.service';

describe('Creators', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const pub = { publish: jest.fn(), replyInstagramComment: jest.fn(), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn() };
  const ai = {
    configured: true,
    model: 'test-model',
    chatCreators: jest.fn(async () => ({
      reply: 'Which country should the creators be based in?',
      criteria: { query: 'sourdough', creatorCountries: [], creatorMinFollowers: 10000, creatorMaxFollowers: 100000, creatorInterests: [], creatorGender: undefined, creatorAgeBucket: undefined, majorAudienceCountries: [], recommendationType: undefined, similarTo: [] },
      ready_to_search: false,
      missing: ['creator country'],
    })),
  };
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PublishersService).useValue(pub)
      .overrideProvider(AiService).useValue(ai)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    alice = (await http().post('/auth/register').send({ email: 'creators-alice@example.com', password: 'password123' }).expect(201)).body.token as string;
    bob = (await http().post('/auth/register').send({ email: 'creators-bob@example.com', password: 'password123' }).expect(201)).body.token as string;
    // Registration switches ai on; this suite needs a client without it.
    const me = await http().get('/auth/me').set('Authorization', `Bearer ${bob}`).expect(200);
    await prisma.clientFeatureFlag.upsert({
      where: { clientId_featureKey: { clientId: (me.body.client as { id: string }).id, featureKey: 'ai' } },
      update: { enabled: false },
      create: { clientId: (me.body.client as { id: string }).id, featureKey: 'ai', enabled: false },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('chat', () => {
    it('a client without the ai switch is told it is switched off', async () => {
      const res = await http().post('/creators/chat').set('Authorization', `Bearer ${bob}`).send({ messages: [{ role: 'user', content: 'find bakers' }] }).expect(403);
      expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'ai' });
    });

    it('rejects an empty conversation and returns the AI reply otherwise', async () => {
      await http().post('/creators/chat').set('Authorization', `Bearer ${alice}`).send({ messages: [] }).expect(400);
      const res = await http().post('/creators/chat').set('Authorization', `Bearer ${alice}`).send({ messages: [{ role: 'user', content: 'find sourdough bakers' }] }).expect(201);
      expect(res.body.reply).toContain('country');
      expect(res.body.criteria).toMatchObject({ query: 'sourdough' });
      expect(res.body.ready_to_search).toBe(false);
    });

    it('sanitizes invented AI values instead of failing the chat', async () => {
      ai.chatCreators.mockResolvedValueOnce({
        reply: 'Searching now.',
        criteria: { query: 'fitness', creatorCountries: ['IN'], creatorMinFollowers: 10000, creatorMaxFollowers: 999999999, creatorInterests: ['fitness'], creatorGender: 'any', creatorAgeBucket: 'any', majorAudienceCountries: ['IN'], recommendationType: 'list', similarTo: [] },
        ready_to_search: true,
        missing: [],
      });
      const res = await http().post('/creators/chat').set('Authorization', `Bearer ${alice}`).send({ messages: [{ role: 'user', content: 'Fitness creators in india with 10K+ followers' }] }).expect(201);
      expect(res.body.criteria).toMatchObject({ creatorMinFollowers: 10000, creatorMaxFollowers: 1000000, creatorInterests: ['FITNESS_AND_WORKOUTS'] });
      expect(res.body.criteria.creatorGender).toBeUndefined();
      expect(res.body.criteria.recommendationType).toBeUndefined();
    });
  });

  describe('search', () => {
    it('returns sample creators when no Facebook Page is connected', async () => {
      const res = await http().post('/creators/search').set('Authorization', `Bearer ${bob}`).send({ criteria: { query: 'baking' } }).expect(201);
      expect(res.body.source).toBe('sample');
      expect(res.body.creators).toHaveLength(5);
      expect(res.body.notice).toMatch(/Facebook Page/);
    });

    it('sanitizes invented values instead of failing', async () => {
      // min above max drops the max; unknown interests and genders are dropped.
      const res = await http().post('/creators/search').set('Authorization', `Bearer ${bob}`).send({
        criteria: { creatorMinFollowers: 100000, creatorMaxFollowers: 10000, creatorInterests: ['NOT_A_THING', 'fitness'], creatorGender: 'any' },
      }).expect(201);
      expect(res.body.source).toBe('sample');
      expect(res.body.creators).toHaveLength(5);
    });
  });

  describe('shortlist', () => {
    it('saves, lists, and removes, scoped to each client', async () => {
      const saved = await http().post('/creators/shortlist').set('Authorization', `Bearer ${alice}`).send({ username: '@baker.maya', country: 'US', followers: 42000 }).expect(201);
      expect(saved.body.username).toBe('baker.maya');

      // Saving twice returns the same row.
      const again = await http().post('/creators/shortlist').set('Authorization', `Bearer ${alice}`).send({ username: 'baker.maya' }).expect(201);
      expect(again.body.id).toBe(saved.body.id);

      expect((await http().get('/creators/shortlist').set('Authorization', `Bearer ${alice}`).expect(200)).body.map((r: any) => r.username)).toEqual(['baker.maya']);
      expect((await http().get('/creators/shortlist').set('Authorization', `Bearer ${bob}`).expect(200)).body).toEqual([]);

      // Another client's id does not exist for this client.
      await http().delete(`/creators/shortlist/${saved.body.id}`).set('Authorization', `Bearer ${bob}`).expect(404);
      await http().delete(`/creators/shortlist/${saved.body.id}`).set('Authorization', `Bearer ${alice}`).expect(204);
      expect((await http().get('/creators/shortlist').set('Authorization', `Bearer ${alice}`).expect(200)).body).toEqual([]);
    });

    it('rejects a missing username', async () => {
      await http().post('/creators/shortlist').set('Authorization', `Bearer ${alice}`).send({}).expect(400);
    });
  });
});
