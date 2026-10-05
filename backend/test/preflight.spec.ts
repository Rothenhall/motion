import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'child_process';
import { rmSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AiService, PreflightInput, PreflightReport } from '../src/ai/ai.service';
import { UPLOAD_DIR } from '../src/media.controller';
import { PrismaService } from '../src/prisma.service';
import { TribeClient } from '../src/preflight/tribe.client';

const report = (score: number): PreflightReport => ({
  verdict: 'Your opening is slow; many viewers may swipe away before the point.',
  hook: { rating: score < 50 ? 'WEAK' : 'STRONG', score, reason: 'No face or words in the first 2 seconds.' },
  dimensions: [{ key: 'HOOK', rating: 'WEAK', note: 'Slow pan' }],
  insights: [{ title: 'Slow opening', detail: 'Viewers may swipe in the first 3 seconds.', fix: 'Open on the result.', severity: 'HIGH', startSec: 0, endSec: 3, basis: 'VISUAL_REVIEW' }],
  alternativeHooks: ['I tried this for 30 days', 'Stop doing this', 'Here is the result first'],
});

const simulation = (hook: number) => ({
  baseline: 'clip', reference_label: null, seconds: 4,
  curves: { attention_index: [40, 45, 60, 55], faces: [20, 30, 70, 60] },
  sound_off_attention: [30, 35, 50, 45],
  scores: { hook: { value: hook, percentile: null, z: -1 }, hold: { value: 50, percentile: null }, ending: null, human_pull_opening: null, emotional_resonance: null, text_load_peak: null, message_clarity: null, sound_off_resilience: { value: 70, percentile: null } },
  facts: { first_face_second: 2, short_clip: true, speech_seconds: 0 },
  moments: [{ kind: 'drop_risk', start: 1, end: 3, level: 30, drivers: [{ system: 'visual_motion', direction: 'low', z: -1.2 }, { system: 'default_mode', direction: 'high', z: 0.9 }] }],
  transcript: [{ word: 'hello', start: 0.5, duration: 0.2 }],
  has_audio: true, model: 'facebook/tribev2', version: '1',
});

describe('Pre-flight check', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: string;
  let bob: string;
  const files: string[] = [];
  const ai = { configured: true, model: 'test-model', reviewContent: jest.fn(async (_: PreflightInput) => report(40)) };
  const tribe = { configured: true, analyze: jest.fn(async (_path: string, _opts: { soundOff: boolean }) => simulation(30)) };

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const register = async (email: string) => (await http().post('/auth/register').send({ email, password: 'password123' }).expect(201)).body.token as string;

  const upload = (ext: string, make: (path: string) => void) => {
    const name = `${Date.now()}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}.${ext}`;
    const path = join(UPLOAD_DIR, name);
    make(path);
    files.push(path);
    return `http://localhost:3001/media/${name}`;
  };
  const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  const video = () => upload('mp4', (p) => ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=5:size=320x568:rate=10', '-f', 'lavfi', '-i', 'sine=duration=5', '-shortest', '-pix_fmt', 'yuv420p', p]));
  const image = () => upload('png', (p) => ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x640', '-frames:v', '1', p]));

  const finished = async (token: string, id: string) => {
    for (let i = 0; i < 100; i++) {
      const res = await http().get(`/preflight/${id}`).set(auth(token)).expect(200);
      if (res.body.status === 'DONE' || res.body.status === 'FAILED') return res.body;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('check did not finish');
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AiService).useValue(ai)
      .overrideProvider(TribeClient).useValue(tribe)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    alice = await register('preflight-alice@example.com');
    bob = await register('preflight-bob@example.com');
  });

  afterAll(async () => {
    files.forEach((f) => rmSync(f, { force: true }));
    // api.spec expects to register the first user; leave the database as we found it.
    await prisma.user.deleteMany({ where: { email: { startsWith: 'preflight-' } } });
    await app.close();
  });

  beforeEach(() => {
    ai.configured = true;
    tribe.configured = true;
    ai.reviewContent.mockClear();
    tribe.analyze.mockClear();
  });

  it('reviews a reel with the audience simulation and the frames', async () => {
    const created = await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [video()], caption: 'My morning routine', platform: 'instagram' }).expect(201);
    expect(created.body).toMatchObject({ kind: 'VIDEO', status: 'PENDING', platform: 'instagram' });

    const done = await finished(alice, created.body.id);
    expect(done.status).toBe('DONE');
    expect(done.engine).toBe('AUDIENCE_SIMULATION');
    expect(done.report.verdict).toContain('opening is slow');
    expect(done.signals.video).toMatchObject({ hasAudio: true, width: 320, height: 568 });
    expect(done.signals.video.durationSec).toBeCloseTo(5, 0);
    expect(done.signals.simulation.curves.attention_index).toEqual([40, 45, 60, 55]);
    expect(done.signals.simulation.transcript).toBeUndefined();
    expect(done).not.toHaveProperty('mediaHash');

    expect(tribe.analyze).toHaveBeenCalledWith(expect.stringContaining(UPLOAD_DIR), { soundOff: true });
    const input = ai.reviewContent.mock.calls[0][0];
    expect(input.kind).toBe('VIDEO');
    expect(input.images.map((i) => i.label)).toEqual(expect.arrayContaining(['Frame at 0.0s', 'Frame at 1.0s', 'Frame at 2.0s', 'Frame at 3.0s']));
    expect(input.images[0].mediaType).toBe('image/jpeg');
    expect(input.simulation).toMatchObject({ baseline: 'clip', attentionBySecond: [40, 45, 60, 55], transcript: '[0.5s] hello' });
    expect(input.simulation!.moments).toEqual([{ what: expect.stringContaining('attention dips'), fromSec: 1, toSec: 3, level: 30, becauseViewersAre: ['less tracking motion on screen than usual', 'more mind-wandering than usual'] }]);
    expect(input.simulation!.responsesBySecond).toEqual({ 'noticing people and faces': [20, 30, 70, 60] });
    expect(JSON.stringify(input.simulation)).not.toMatch(/visual_motion|default_mode|brain/);
    expect(input.facts).toMatchObject({ vertical: true, hasSoundtrack: true });
  });

  it('still gives insights when the simulation is not configured or fails', async () => {
    tribe.configured = false;
    const plain = await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [video()] }).expect(201);
    const done = await finished(alice, plain.body.id);
    expect(done).toMatchObject({ status: 'DONE', engine: 'AI_REVIEW' });
    expect(tribe.analyze).not.toHaveBeenCalled();
    expect(ai.reviewContent.mock.calls[0][0].simulation).toBeNull();

    tribe.configured = true;
    tribe.analyze.mockRejectedValueOnce(new Error('The audience simulation service did not respond.'));
    const failed = await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [video()] }).expect(201);
    const fallback = await finished(alice, failed.body.id);
    expect(fallback).toMatchObject({ status: 'DONE', engine: 'AI_REVIEW' });
    expect(fallback.signals.simulationError).toContain('did not respond');
  });

  it('reviews images, carousels and text posts with the AI only', async () => {
    const single = await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [image()], caption: 'New drop' }).expect(201);
    expect(single.body.kind).toBe('IMAGE');
    await finished(alice, single.body.id);
    expect(ai.reviewContent.mock.calls[0][0].images).toHaveLength(1);

    const carousel = await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [image(), image()] }).expect(201);
    expect(carousel.body.kind).toBe('CAROUSEL');
    await finished(alice, carousel.body.id);
    expect(ai.reviewContent.mock.calls[1][0].images.map((i) => i.label)).toEqual(['Slide 1', 'Slide 2']);

    const text = await http().post('/preflight').set(auth(alice)).send({ text: 'Hot take: most morning routines are a waste of time.', platform: 'threads' }).expect(201);
    expect(text.body.kind).toBe('TEXT');
    expect((await finished(alice, text.body.id)).status).toBe('DONE');
    expect(tribe.analyze).not.toHaveBeenCalled();
  });

  it('validates what gets checked', async () => {
    await http().post('/preflight').set(auth(alice)).send({}).expect(400);
    await http().post('/preflight').set(auth(alice)).send({ text: 'x', platform: 'myspace' }).expect(400);
    await http().post('/preflight').set(auth(alice)).send({ mediaUrls: ['http://localhost:3001/media/../../package.json'] }).expect(400);
    await http().post('/preflight').set(auth(alice)).send({ mediaUrls: ['http://localhost:3001/media/1-deadbeef.mp4'] }).expect(400);
    await http().post('/preflight').set(auth(alice)).send({ mediaUrls: 'nope' }).expect(400);
    await http().post('/preflight').set(auth(alice)).send({ mediaUrls: [video(), image()] }).expect(400);
    expect(ai.reviewContent).not.toHaveBeenCalled();
  });

  it('needs the AI to be configured', async () => {
    ai.configured = false;
    await http().post('/preflight').set(auth(alice)).send({ text: 'hello' }).expect(503);
    expect((await http().get('/preflight/status').set(auth(alice)).expect(200)).body).toEqual({ ai: false, audienceSimulation: true });
  });

  it('records failures and retries them', async () => {
    ai.reviewContent.mockRejectedValueOnce(new Error('The AI request failed. Try again.'));
    const created = await http().post('/preflight').set(auth(alice)).send({ text: 'retry me' }).expect(201);
    const failed = await finished(alice, created.body.id);
    expect(failed).toMatchObject({ status: 'FAILED', error: 'The AI request failed. Try again.' });
    await http().post(`/preflight/${created.body.id}/retry`).set(auth(bob)).expect(404);
    await http().post(`/preflight/${created.body.id}/retry`).set(auth(alice)).expect(201);
    expect((await finished(alice, created.body.id)).status).toBe('DONE');
  });

  it('ranks versions by the simulated hook when every version has one', async () => {
    tribe.analyze.mockResolvedValueOnce(simulation(30)).mockResolvedValueOnce(simulation(80));
    const res = await http().post('/preflight/compare').set(auth(alice)).send({ variants: [{ mediaUrls: [video()] }, { mediaUrls: [video()] }] }).expect(201);
    expect(res.body.checks.map((c: any) => c.label)).toEqual(['Version A', 'Version B']);
    for (const c of res.body.checks) await finished(alice, c.id);
    const group = (await http().get(`/preflight/groups/${res.body.groupId}`).set(auth(alice)).expect(200)).body;
    expect(group.done).toBe(true);
    expect(group.rankedBy).toBe('AUDIENCE_SIMULATION');
    expect(group.ranking.map((r: any) => [r.label, r.score])).toEqual([['Version B', 80], ['Version A', 30]]);
    await http().get(`/preflight/groups/${res.body.groupId}`).set(auth(bob)).expect(404);

    await http().post('/preflight/compare').set(auth(alice)).send({ variants: [{ text: 'only one' }] }).expect(400);
    await http().post('/preflight/compare').set(auth(alice)).send({ variants: [{ text: 'text' }, { mediaUrls: [image()] }] }).expect(400);
  });

  it('keeps checks private to their owner', async () => {
    const created = await http().post('/preflight').set(auth(bob)).send({ text: 'bob only' }).expect(201);
    await finished(bob, created.body.id);
    await http().get(`/preflight/${created.body.id}`).set(auth(alice)).expect(404);
    expect((await http().get('/preflight').set(auth(alice)).expect(200)).body.map((c: any) => c.id)).not.toContain(created.body.id);
    expect((await http().get('/preflight').set(auth(bob)).expect(200)).body.map((c: any) => c.id)).toEqual([created.body.id]);
    await http().delete(`/preflight/${created.body.id}`).set(auth(alice)).expect(204);
    expect(await prisma.contentCheck.findUnique({ where: { id: created.body.id } })).not.toBeNull();
    await http().delete(`/preflight/${created.body.id}`).set(auth(bob)).expect(204);
    expect(await prisma.contentCheck.findUnique({ where: { id: created.body.id } })).toBeNull();
  });
});
