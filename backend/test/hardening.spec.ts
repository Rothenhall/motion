import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import { existsSync, readdirSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { UPLOAD_DIR, looksLike } from '../src/media.controller';
import { UploadsCleanupService } from '../src/uploads-cleanup.service';
import { UPLOAD_NAME, uploadNameOf } from '../src/upload-names';
import { encryptToken, hashPassword, signToken } from '../src/auth/crypto';
import { ACME_DISABLED_EMAIL, ACME_INVITED_EMAIL, CLIENT_EMAIL, DEMO_EMAIL, DEMO_PASSWORD, NORTHWIND_EMAIL, PAUSED_EMAIL, SEED_EMAILS, removeSeed, seedDemo } from '../src/scripts/seed-demo';
import { FeaturesService } from '../src/tenancy/features.service';

/**
 * Phase 5 hardening. Media: a client can only use files its own client uploaded, staff acting as a client can use that
 * client's files, uploads are recorded with the acting client, and the nightly cleanup never removes a file that any
 * client's post, draft or check still points at.
 */
describe('Hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let features: FeaturesService;
  const pub = { publish: jest.fn(), replyInstagramComment: jest.fn(), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn() };
  const ai = { configured: true, model: 'test-model', reviewContent: jest.fn(async () => { throw new Error('not used'); }) };
  const http = () => request(app.getHttpServer());
  const made = { clients: [] as string[], users: [] as string[], files: [] as string[], externalIds: [] as string[] };
  const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  const soon = () => new Date(Date.now() + 3_600_000).toISOString();

  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF'), Buffer.alloc(32)]);

  async function makeUser(email: string, role: Role, clientId: string) {
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword('password123'), role, clientId } });
    made.users.push(user.id);
    return { user, token: signToken(user.id, 'session', 3600) };
  }

  async function world(label: string) {
    const client = await prisma.client.create({ data: { name: `Hardening ${label}` } });
    made.clients.push(client.id);
    await features.set(client.id, 'ai', true);
    const { user, token } = await makeUser(`hardening-${label}@example.com`, Role.CLIENT_POC, client.id);
    const externalId = `ig-hardening-${label}-${Date.now()}`;
    made.externalIds.push(externalId);
    const account = await prisma.socialAccount.create({ data: { userId: user.id, clientId: client.id, provider: 'instagram', externalId, name: `@${label}`, accessToken: encryptToken('token') } });
    return { client, user, token, account };
  }
  type World = Awaited<ReturnType<typeof world>>;

  let A: World;
  let B: World;
  let admin: { user: { id: string }; token: string };
  let adminHome: { id: string };

  /** Uploads through the real endpoint and remembers the file for cleanup. */
  async function upload(token: string, content: Buffer, mime: string, filename: string, extra: Record<string, string> = {}) {
    const res = await http().post('/media/upload').set(bearer(token, extra)).attach('file', content, { filename, contentType: mime });
    if (res.status === 201) made.files.push(String(res.body.url).split('/').pop() as string);
    return res;
  }
  const nameOf = (url: string) => url.split('/').pop() as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).overrideProvider(AiService).useValue(ai).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    features = app.get(FeaturesService);
    A = await world('a');
    B = await world('b');
    adminHome = await prisma.client.create({ data: { name: 'Hardening staff home' } });
    made.clients.push(adminHome.id);
    admin = await makeUser('hardening-admin@example.com', Role.ADMIN, adminHome.id);
  });

  afterAll(async () => {
    const clientIds = made.clients;
    await new Promise((r) => setTimeout(r, 300)); // let a background check that started finish before its rows go
    await prisma.socialAccount.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { externalId: { in: made.externalIds } }] } });
    await prisma.contentCheck.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.postDraft.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    for (const f of made.files) rmSync(join(UPLOAD_DIR, f), { force: true });
    await app.close();
  });

  // ---------------------------------------------------------------- media

  describe('uploads', () => {
    it('are named with a long random part and an extension chosen by Motion, never by the visitor', async () => {
      const res = await upload(A.token, PNG, 'image/png', 'holiday.html');
      expect(res.status).toBe(201);
      const name = nameOf(res.body.url);
      expect(name).toMatch(/^\d+-[0-9a-f]{32}\.png$/);
      expect(UPLOAD_NAME.test(name)).toBe(true);
      expect((await upload(A.token, JPEG, 'image/jpeg', 'x.svg')).body.url).toMatch(/\.jpg$/);
      expect(res.body.kind).toBe('IMAGE');
    });

    it('are recorded with the client they were uploaded for', async () => {
      const own = await upload(A.token, PNG, 'image/png', 'a.png');
      expect(await prisma.mediaFile.findUnique({ where: { name: nameOf(own.body.url) } })).toMatchObject({ clientId: A.client.id, uploadedById: A.user.id });

      // Staff acting as a client upload for that client, not for their own workspace.
      const acting = await upload(admin.token, PNG, 'image/png', 'b.png', { 'X-Client-Id': B.client.id });
      expect(await prisma.mediaFile.findUnique({ where: { name: nameOf(acting.body.url) } })).toMatchObject({ clientId: B.client.id, uploadedById: admin.user.id });

      // Without a header, the staff member's home workspace.
      const home = await upload(admin.token, PNG, 'image/png', 'c.png');
      expect(await prisma.mediaFile.findUnique({ where: { name: nameOf(home.body.url) } })).toMatchObject({ clientId: adminHome.id });
    });

    it('refuse files that are not what they claim to be, and leave nothing on disk', async () => {
      const before = readdirSync(UPLOAD_DIR).length;
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      expect((await upload(A.token, html, 'image/png', 'a.png')).status).toBe(400); // labelled as a picture
      expect((await upload(A.token, html, 'video/mp4', 'a.mp4')).status).toBe(400);
      expect((await upload(A.token, html, 'text/html', 'a.html')).status).toBe(400); // honest, but not allowed
      expect((await upload(A.token, Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml', 'a.svg')).status).toBe(400);
      expect((await upload(A.token, PNG, 'application/octet-stream', 'a.png')).status).toBe(400);
      expect(readdirSync(UPLOAD_DIR).length).toBe(before);
    });

    it('require a file and a signed-in user', async () => {
      await http().post('/media/upload').set(bearer(A.token)).expect(400);
      await http().post('/media/upload').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(401);
    });

    it('are limited in how many one address can send a minute', async () => {
      process.env.RATE_LIMIT = 'on';
      try {
        let blocked = 0;
        for (let i = 0; i < 64; i++) {
          const res = await upload(B.token, PNG, 'image/png', 'a.png');
          if (res.status === 429) blocked++;
        }
        expect(blocked).toBeGreaterThan(0);
      } finally {
        process.env.RATE_LIMIT = 'off';
      }
    });

    it('recognise the start of each allowed type', () => {
      expect(looksLike('image/png', PNG)).toBe(true);
      expect(looksLike('image/jpeg', JPEG)).toBe(true);
      expect(looksLike('image/gif', Buffer.from('GIF89a......'))).toBe(true);
      expect(looksLike('image/webp', Buffer.from('RIFF....WEBPVP8 '))).toBe(true);
      expect(looksLike('video/mp4', Buffer.from('....ftypisom....'))).toBe(true);
      expect(looksLike('video/quicktime', Buffer.from('....moov........'))).toBe(true);
      expect(looksLike('image/png', JPEG)).toBe(false);
      expect(looksLike('video/mp4', PNG)).toBe(false);
      expect(looksLike('text/html', Buffer.from('<html>'))).toBe(false);
    });
  });

  describe('using another client\'s file', () => {
    let urlA: string;
    let postA: { id: string };

    /** The same file written the ways a URL can name it: encoded, doubled slashes, shouting, another host. */
    const variants = (url: string) => {
      const name = nameOf(url);
      const encoded = `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`;
      return [url, url.replace(name, name.toUpperCase()), url.replace(`/media/${name}`, `/media//${name}`), url.replace(`/media/${name}`, `/media/${encoded}`), `https://other.example.dev/x/${name}`, `${url}?v=2`];
    };

    beforeAll(async () => {
      urlA = (await upload(A.token, JPEG, 'image/jpeg', 'a.jpg')).body.url;
      postA = (await http().post('/posts').set(bearer(A.token)).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: [urlA], scheduledAt: soon() }).expect(201)).body;
    });

    it('the owner can attach it to posts, drafts and checks', async () => {
      const draft = await http().post('/drafts').set(bearer(A.token)).send({ mediaUrls: [urlA] }).expect(201);
      await http().patch(`/drafts/${draft.body.id}`).set(bearer(A.token)).send({ mediaUrls: [urlA] }).expect(200);
      await http().patch(`/posts/${postA.id}`).set(bearer(A.token)).send({ mediaUrls: [urlA] }).expect(200);
      await http().post('/preflight').set(bearer(A.token)).send({ mediaUrls: [urlA] }).expect(201);
    });

    it('no other client can, whichever way the address is written', async () => {
      for (const url of variants(urlA)) {
        const post = await http().post('/posts').set(bearer(B.token)).send({ accountId: B.account.id, platform: 'instagram', mediaUrls: [url], scheduledAt: soon() });
        const draft = await http().post('/drafts').set(bearer(B.token)).send({ mediaUrls: [url] });
        const check = await http().post('/preflight').set(bearer(B.token)).send({ mediaUrls: [url] });
        const compare = await http().post('/preflight/compare').set(bearer(B.token)).send({ variants: [{ mediaUrls: [url] }, { mediaUrls: [url] }] });
        // The ones on other hosts are plain links to someone else's server and are not Motion's to judge: only the ones that reach this server's files must fail.
        const reachesOurFile = !url.startsWith('https://other.example.dev');
        if (reachesOurFile) {
          expect([post.status, draft.status, check.status, compare.status]).toEqual([400, 400, 400, 400]);
        }
      }
      expect(await prisma.scheduledPost.count({ where: { accountId: B.account.id } })).toBe(0);
      expect(await prisma.postDraft.count({ where: { clientId: B.client.id } })).toBe(0);
      expect(await prisma.contentCheck.count({ where: { clientId: B.client.id } })).toBe(0);
    });

    it('nor can they swap it into a post or draft they already have', async () => {
      const own = (await http().post('/posts').set(bearer(B.token)).send({ accountId: B.account.id, platform: 'instagram', mediaUrls: [], scheduledAt: soon() }).expect(201)).body;
      await http().patch(`/posts/${own.id}`).set(bearer(B.token)).send({ mediaUrls: [urlA] }).expect(400);
      const draft = (await http().post('/drafts').set(bearer(B.token)).send({ caption: 'mine' }).expect(201)).body;
      await http().patch(`/drafts/${draft.id}`).set(bearer(B.token)).send({ mediaUrls: [urlA] }).expect(400);
      expect(JSON.parse((await prisma.scheduledPost.findUniqueOrThrow({ where: { id: own.id } })).mediaUrls)).toEqual([]);
    });

    it('does not show up in any list another client can read', async () => {
      for (const route of ['/posts', '/drafts', '/preflight', '/analytics', '/dashboard', '/comments/events']) {
        const res = await http().get(route).set(bearer(B.token)).expect(200);
        expect(JSON.stringify(res.body)).not.toContain(nameOf(urlA));
      }
      // Another client's post and draft ids answer 404, so their media is not readable through them either.
      await http().patch(`/posts/${postA.id}`).set(bearer(B.token)).send({ caption: 'x' }).expect(404);
      await http().delete(`/posts/${postA.id}`).set(bearer(B.token)).expect(404);
    });

    it('staff acting as the owner can use it, and staff acting as anyone else cannot', async () => {
      await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': A.client.id })).send({ mediaUrls: [urlA] }).expect(201);
      const post = await http().post('/posts').set(bearer(admin.token, { 'X-Client-Id': A.client.id })).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: [urlA], scheduledAt: soon() }).expect(201);
      expect(post.body.createdById).toBe(admin.user.id);
      await http().post('/drafts').set(bearer(admin.token, { 'X-Client-Id': B.client.id })).send({ mediaUrls: [urlA] }).expect(400);
      await http().post('/drafts').set(bearer(admin.token)).send({ mediaUrls: [urlA] }).expect(400); // their own workspace is not A either
    });

    it('a read-only preview cannot upload or attach anything', async () => {
      const view = { 'X-Client-Id': A.client.id, 'X-Preview-Mode': 'view' };
      const before = readdirSync(UPLOAD_DIR).length;
      expect((await upload(admin.token, PNG, 'image/png', 'a.png', view)).body.code).toBe('PREVIEW_READ_ONLY');
      await http().post('/drafts').set(bearer(admin.token, view)).send({ mediaUrls: [urlA] }).expect(403);
      expect(readdirSync(UPLOAD_DIR).length).toBe(before);
    });

    it('cannot be deleted through the API by anyone', async () => {
      const name = nameOf(urlA);
      for (const token of [A.token, B.token, admin.token]) {
        await http().delete(`/media/${name}`).set(bearer(token)).expect(404);
        await http().put(`/media/${name}`).set(bearer(token)).expect(404);
      }
      expect(existsSync(join(UPLOAD_DIR, name))).toBe(true);
    });

    it('is still handed to the publisher only for the post that owns it', async () => {
      // The publisher reads the URL stored on the post. Another client's post can never hold it, so it can never be sent with theirs.
      const holders = await prisma.scheduledPost.findMany({ where: { mediaUrls: { contains: nameOf(urlA) } }, select: { account: { select: { clientId: true } } } });
      expect(holders.length).toBeGreaterThan(0);
      expect(holders.every((p) => p.account.clientId === A.client.id)).toBe(true);
    });

    it('name parsing sees through encodings', () => {
      const name = nameOf(urlA);
      for (const url of variants(urlA).slice(0, 5)) expect(uploadNameOf(url)).toBe(name);
      expect(uploadNameOf('https://cdn.example.com/a.jpg')).toBeNull();
      expect(uploadNameOf('not a url')).toBeNull();
      expect(uploadNameOf('http://x/media/1000-deadbeef.png')).toBe('1000-deadbeef.png'); // the old 8-character names still count
    });
  });

  describe('the nightly cleanup', () => {
    const DAY = 86_400_000;
    const cleanup = () => new UploadsCleanupService(prisma);
    const old = (name: string) => { const when = new Date(Date.now() - 90 * DAY); utimesSync(join(UPLOAD_DIR, name), when, when); };

    afterEach(() => { delete process.env.UPLOAD_CLEANUP; });

    it('keeps every file any client\'s post, draft or check still uses, and removes only the unused one', async () => {
      process.env.UPLOAD_CLEANUP = 'on';
      const [inPost, inDraft, inCheck, inEncoded, unused] = await Promise.all(
        [A, A, B, B, B].map(async (w, i) => nameOf((await upload(w.token, JPEG, 'image/jpeg', `${i}.jpg`)).body.url)),
      );
      const url = (n: string) => `https://tunnel.example.dev/media/${n}`;
      await prisma.scheduledPost.create({ data: { accountId: A.account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: JSON.stringify([url(inPost)]), scheduledAt: new Date(), status: 'PUBLISHED' } });
      await prisma.postDraft.create({ data: { userId: A.user.id, clientId: A.client.id, mediaUrls: JSON.stringify([url(inDraft)]) } });
      await prisma.contentCheck.create({ data: { userId: B.user.id, clientId: B.client.id, kind: 'IMAGE', platform: 'instagram', mediaUrls: JSON.stringify([url(inCheck)]) } });
      // Referenced in an unusual way: percent-encoded in a post of another client.
      const encoded = `%${inEncoded.charCodeAt(0).toString(16)}${inEncoded.slice(1)}`;
      await prisma.scheduledPost.create({ data: { accountId: B.account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: JSON.stringify([url(encoded)]), scheduledAt: new Date(), status: 'PUBLISHED' } });
      for (const n of [inPost, inDraft, inCheck, inEncoded, unused]) old(n);

      const result = await cleanup().sweep();
      expect(result.orphans).toContain(unused);
      for (const kept of [inPost, inDraft, inCheck, inEncoded]) {
        expect(result.orphans).not.toContain(kept);
        expect(existsSync(join(UPLOAD_DIR, kept))).toBe(true);
      }
      expect(existsSync(join(UPLOAD_DIR, unused))).toBe(false);
    });

    it('only reports unless UPLOAD_CLEANUP=on', async () => {
      const name = nameOf((await upload(A.token, JPEG, 'image/jpeg', 'u.jpg')).body.url);
      old(name);
      for (const setting of [undefined, 'off', 'true', 'ON']) {
        if (setting === undefined) delete process.env.UPLOAD_CLEANUP; else process.env.UPLOAD_CLEANUP = setting;
        const result = await cleanup().sweep();
        expect(result.orphans).toContain(name);
        expect(result.removed).toBe(0);
        expect(existsSync(join(UPLOAD_DIR, name))).toBe(true);
      }
    });

    it('does not touch a fresh upload that nothing uses yet', async () => {
      process.env.UPLOAD_CLEANUP = 'on';
      const name = nameOf((await upload(A.token, JPEG, 'image/jpeg', 'fresh.jpg')).body.url);
      await cleanup().sweep();
      expect(existsSync(join(UPLOAD_DIR, name))).toBe(true);
    });
  });

  // ---------------------------------------------------------------- the demo seed

  describe('demo seed', () => {
    const snapshot = async () => ({
      users: await prisma.user.count({ where: { email: { in: SEED_EMAILS } } }),
      clients: await prisma.client.count({ where: { users: { some: { email: { in: SEED_EMAILS } } } } }),
      accounts: await prisma.socialAccount.count({ where: { client: { users: { some: { email: { in: SEED_EMAILS } } } } } }),
      posts: await prisma.scheduledPost.count({ where: { account: { client: { users: { some: { email: { in: SEED_EMAILS } } } } } } }),
      audit: await prisma.adminAuditLog.count({ where: { clientId: { in: (await prisma.user.findMany({ where: { email: { in: SEED_EMAILS } }, select: { clientId: true } })).map((u) => u.clientId as string) } } }),
    });
    const login = (email: string) => http().post('/auth/login').send({ email, password: DEMO_PASSWORD });

    afterAll(() => removeSeed(prisma));

    it('is repeatable, and leaves everything that is not sample data alone', async () => {
      const before = { clients: await prisma.client.count({ where: { id: { in: [A.client.id, B.client.id] } } }), accounts: await prisma.socialAccount.count({ where: { clientId: { in: [A.client.id, B.client.id] } } }) };
      await seedDemo(prisma);
      const first = await snapshot();
      await seedDemo(prisma);
      expect(await snapshot()).toEqual(first);
      expect(first).toMatchObject({ users: 6, clients: 4, accounts: 5 });
      expect(await prisma.client.count({ where: { id: { in: [A.client.id, B.client.id] } } })).toBe(before.clients);
      expect(await prisma.socialAccount.count({ where: { clientId: { in: [A.client.id, B.client.id] } } })).toBe(before.accounts);
      expect(await prisma.user.count({ where: { id: { in: [A.user.id, B.user.id, admin.user.id] } } })).toBe(3);
    });

    it('does not remove a workspace that someone outside the sample data also belongs to', async () => {
      await seedDemo(prisma);
      const acme = await prisma.user.findUniqueOrThrow({ where: { email: CLIENT_EMAIL } });
      const stranger = await prisma.user.create({ data: { email: 'hardening-stranger@example.com', passwordHash: 'x', role: Role.CLIENT_MEMBER, clientId: acme.clientId } });
      made.users.push(stranger.id);
      await seedDemo(prisma);
      // Acme's sample user is replaced, but the workspace the stranger belongs to stays.
      expect(await prisma.client.count({ where: { id: acme.clientId as string } })).toBe(1);
      await prisma.user.delete({ where: { id: stranger.id } });
      await prisma.client.delete({ where: { id: acme.clientId as string } }); // the kept workspace is now empty
      await removeSeed(prisma);
      await seedDemo(prisma);
    });

    it('builds the four clients the admin console is shown with', async () => {
      const staff = await login(DEMO_EMAIL).expect(200);
      const clients = (await http().get('/admin/clients').set(bearer(staff.body.token))).body.filter((c: any) => /sample client/.test(c.name));
      expect(clients.map((c: any) => c.name.split(' (')[0]).sort()).toEqual(['Acme Bakery', 'Northwind Studio', 'Paused Co']);
      const by = (n: string) => clients.find((c: any) => c.name.startsWith(n));
      expect(by('Paused Co')).toMatchObject({ status: 'SUSPENDED' });
      expect(by('Northwind')).toMatchObject({ failedPosts: 1, disconnectedChannels: 1, channels: [expect.objectContaining({ provider: 'instagram' })] });
      expect(by('Acme')).toMatchObject({ pendingInvites: 1, seatsUsed: 2 });

      const people = (await http().get(`/admin/clients/${by('Acme').id}/users`).set(bearer(staff.body.token)).expect(200)).body.members;
      expect(people.map((p: any) => [p.email, p.status]).sort()).toEqual([[ACME_DISABLED_EMAIL, 'DISABLED'], [ACME_INVITED_EMAIL, 'INVITED'], [CLIENT_EMAIL, 'ACTIVE']]);
      const activity = (await http().get(`/admin/clients/${by('Acme').id}/audit`).set(bearer(staff.body.token)).expect(200)).body;
      expect(activity.map((a: any) => a.action)).toEqual(expect.arrayContaining(['client.create', 'feature.set', 'channel.connect', 'user.invite']));
      expect(activity[0].actor.email).toBeTruthy();
    });

    it('gives each sample login the experience it is meant to show', async () => {
      const nw = (await login(NORTHWIND_EMAIL).expect(200)).body.token;
      const me = (await http().get('/auth/me').set(bearer(nw)).expect(200)).body;
      expect(me.features).toMatchObject({ analytics: false, ai: false, planner: true, compose: true });
      expect((await http().get('/analytics').set(bearer(nw)).expect(403)).body.code).toBe('FEATURE_DISABLED');
      expect((await http().get('/posts').set(bearer(nw)).expect(200)).body.length).toBeGreaterThan(0);
      expect((await http().get('/accounts').set(bearer(nw)).expect(200)).body.map((a: any) => a.provider)).toEqual(['instagram']); // the disconnected one is not listed

      const acme = (await login(CLIENT_EMAIL).expect(200)).body.token;
      expect((await http().get('/team/members').set(bearer(acme)).expect(200)).body.seats).toEqual({ used: 2, limit: 3 });

      // A paused client's contact can sign in but is turned away at once; the invited and switched-off people cannot sign in at all.
      const paused = (await login(PAUSED_EMAIL).expect(200)).body.token;
      expect((await http().get('/auth/me').set(bearer(paused)).expect(403)).body.code).toBe('CLIENT_SUSPENDED');
      await login(ACME_INVITED_EMAIL).expect(401);
      await login(ACME_DISABLED_EMAIL).expect(401);
    });

    it('never publishes anything from the sample data', async () => {
      const due = await prisma.scheduledPost.count({ where: { status: 'SCHEDULED', scheduledAt: { lte: new Date() }, account: { client: { users: { some: { email: { in: SEED_EMAILS } } } } } } });
      expect(due).toBe(0);
      const tokens = await prisma.socialAccount.findMany({ where: { client: { users: { some: { email: { in: SEED_EMAILS } } } } }, select: { accessToken: true } });
      expect(tokens.every((t) => t.accessToken.startsWith('enc:v1:'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------- security review evidence (docs/security-review.md)

  describe('security', () => {
    const PASSWORD = 'password123';
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const tokenOf = (url: string) => new URL(url).searchParams.get('token') as string;
    const sha256 = (v: string) => require('crypto').createHash('sha256').update(v).digest('hex') as string;

    it('refuses forged, tampered, expired and wrong-purpose tokens', async () => {
      const good = signToken(A.user.id, 'session', 3600);
      await http().get('/auth/me').set(bearer(good)).expect(200);
      const [h, p, s] = good.split('.');
      const asAdmin = b64({ sub: admin.user.id, typ: 'session', iat: 1, exp: 9_999_999_999 });
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${asAdmin}.`;
      const cases = [
        none, // alg "none"
        `${h}.${asAdmin}.${s}`, // another user's claims under this signature
        `${h}.${p}.${s.slice(0, -2)}xx`, // damaged signature
        signToken(A.user.id, 'session', -10), // expired
        signToken(A.user.id, 'oauth_state', 600, { provider: 'instagram', clientId: A.client.id }), // a connect-link token is not a session
        signToken('no-such-user', 'session', 3600),
        'garbage', '', 'a.b.c',
      ];
      for (const token of cases) await http().get('/auth/me').set(token ? bearer(token) : {}).expect(401);
      // A session token is not accepted as an OAuth state either: the callback sends the visitor away with an error and connects nothing.
      const before = await prisma.socialAccount.count({ where: { clientId: A.client.id } });
      const res = await http().get('/auth/instagram/callback').query({ code: 'x', state: good }).expect(302);
      expect(res.headers.location).toContain('/connect?error=');
      expect(await prisma.socialAccount.count({ where: { clientId: A.client.id } })).toBe(before);
    });

    it('answers every failed sign-in the same way: unknown, wrong password, invited, disabled, locked', async () => {
      const mk = async (tag: string, data: Record<string, unknown>) => {
        const u = await prisma.user.create({ data: { email: `hardening-login-${tag}@example.com`, passwordHash: await hashPassword(PASSWORD), clientId: A.client.id, role: Role.CLIENT_MEMBER, ...data } as any });
        made.users.push(u.id);
        return u.email;
      };
      const emails = [
        'hardening-login-nobody@example.com',
        await mk('active', {}),
        await mk('invited', { status: 'INVITED', passwordHash: '!no-password-yet' }),
        await mk('disabled', { status: 'DISABLED' }),
        await mk('locked', { lockedUntil: new Date(Date.now() + 600_000) }),
      ];
      const bodies = [];
      for (const email of emails) bodies.push((await http().post('/auth/login').send({ email, password: email.includes('active') ? 'wrong-password' : PASSWORD }).expect(401)).body);
      for (const body of bodies) expect(body).toEqual(bodies[0]);
    });

    it('invite and reset links are 32 random bytes, stored only as a hash, and never logged or put in the audit log', async () => {
      const { Logger } = require('@nestjs/common');
      const spies = ['log', 'warn', 'error', 'debug', 'verbose'].map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined));
      const out = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const created = await http().post('/admin/clients').set(bearer(admin.token)).send({ name: 'Hardening Links Co', pocEmail: 'hardening-links@example.com' }).expect(201);
        made.clients.push(created.body.client.id);
        const user = await prisma.user.findUniqueOrThrow({ where: { email: 'hardening-links@example.com' } });
        made.users.push(user.id);
        const invite = tokenOf(created.body.invite.url);
        expect(Buffer.from(invite, 'base64url').length).toBe(32);
        await http().post('/auth/accept-invite').send({ token: invite, password: PASSWORD }).expect(200);
        const reset = tokenOf((await http().post(`/admin/users/${user.id}/reset-link`).set(bearer(admin.token)).expect(200)).body.reset.url);
        await http().post('/auth/reset-password').send({ token: reset, password: 'another-password-1' }).expect(200);
        await http().post('/auth/login').send({ email: 'hardening-links@example.com', password: 'wrong' }).expect(401);

        const rows = await prisma.authToken.findMany({ where: { userId: user.id } });
        expect(rows.map((r) => r.tokenHash).sort()).toEqual([sha256(invite), sha256(reset)].sort());
        expect(JSON.stringify(rows)).not.toContain(invite);
        const audit = JSON.stringify(await prisma.adminAuditLog.findMany({ where: { clientId: created.body.client.id } }));
        expect(audit).not.toContain(invite);
        expect(audit).not.toContain(reset);
        expect(audit).not.toContain('accept-invite');
        const logged = JSON.stringify([...spies.flatMap((s) => s.mock.calls), ...out.mock.calls]);
        for (const secret of [invite, reset, 'accept-invite?token', PASSWORD, 'another-password-1']) expect(logged).not.toContain(secret);
        await prisma.adminAuditLog.deleteMany({ where: { clientId: created.body.client.id } });
      } finally {
        [...spies, out].forEach((s) => s.mockRestore());
      }
    });

    it('never returns password hashes', async () => {
      for (const res of [await http().get('/auth/me').set(bearer(A.token)), await http().get('/team/members').set(bearer(A.token)), await http().get(`/admin/clients/${A.client.id}/users`).set(bearer(admin.token))]) {
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/scrypt|passwordHash|accessToken|enc:v1/);
      }
      expect(JSON.stringify((await http().get('/accounts').set(bearer(A.token))).body)).not.toMatch(/accessToken|enc:v1/);
    });

    it('rate limits the public invite, reset and sign-up routes', async () => {
      process.env.RATE_LIMIT = 'on';
      try {
        for (const route of ['/auth/accept-invite/validate', '/auth/reset-password/validate', '/auth/accept-invite', '/auth/reset-password', '/auth/register']) {
          let last = 0;
          for (let i = 0; i < 12; i++) last = (await http().post(route).send({ token: 'nope', password: 'password123', email: 'x@example.com' })).status;
          expect([route, last]).toEqual([route, 429]);
        }
      } finally {
        process.env.RATE_LIMIT = 'off';
      }
    });

    it('errors carry a short message and nothing about the server', async () => {
      const probes = [
        await http().get('/no/such/route').set(bearer(A.token)),
        await http().post('/drafts').set(bearer(A.token)).set('Content-Type', 'application/json').send('{"caption": '),
        await http().get('/posts/ ../../etc/passwd').set(bearer(A.token)),
        await http().patch('/drafts/not-a-real-id').set(bearer(A.token)).send({}),
        await http().get('/auth/me'),
      ];
      for (const res of probes) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        const text = JSON.stringify(res.body) + JSON.stringify(res.headers);
        expect(text).not.toMatch(/node_modules|\.ts:\d|\bat \w+.*\(|prisma|postgres|stack|C:\\\\|\/app\/|express/i);
      }
    });

    it('turns away a large JSON body', async () => {
      const big = { caption: 'x'.repeat(300_000) };
      await http().post('/drafts').set(bearer(A.token)).send(big).expect(413);
      await http().post('/auth/login').send({ email: 'a@example.com', password: 'y'.repeat(300_000) }).expect(413);
    });

    it('treats X-Client-Id the same wherever it points', async () => {
      // A client user may never send it: 403 whether the id is theirs, someone else's, made up, or hostile.
      const bodies = [];
      for (const id of [A.client.id, B.client.id, 'made-up', "x' OR '1'='1", 'a'.repeat(5000)]) {
        const res = await http().get('/posts').set(bearer(A.token, { 'X-Client-Id': id })).expect(403);
        bodies.push(res.body);
      }
      for (const b of bodies) expect(b).toEqual(bodies[0]);
      await http().get('/posts').set(bearer(A.token, { 'X-Client-Id': '   ' })).expect(200); // blank counts as absent
      // Staff: a client that does not exist, is hostile, or is archived all look alike.
      const archived = await prisma.client.create({ data: { name: 'Hardening archived', archivedAt: new Date() } });
      made.clients.push(archived.id);
      const answers = [];
      for (const id of ['made-up', "x' OR '1'='1", archived.id, 'a'.repeat(5000)]) answers.push((await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': id })).expect(404)).body);
      for (const b of answers) expect(b).toEqual(answers[0]);
      // And a real client works, listing only that client.
      expect((await http().get('/posts').set(bearer(admin.token, { 'X-Client-Id': B.client.id })).expect(200)).body.every((p: any) => p.account.id === B.account.id)).toBe(true);
    });

    it('another client\'s ids are indistinguishable from ids that do not exist', async () => {
      const draft = await prisma.postDraft.create({ data: { userId: A.user.id, clientId: A.client.id, caption: 'A only' } });
      const check = await prisma.contentCheck.create({ data: { userId: A.user.id, clientId: A.client.id, kind: 'TEXT', platform: 'instagram', text: 't', status: 'DONE' } });
      const idea = await prisma.contentIdea.create({ data: { userId: A.user.id, clientId: A.client.id, title: 'A idea', hook: 'h', format: 'REEL', platform: 'instagram' } });
      const hook = await prisma.hook.create({ data: { userId: A.user.id, clientId: A.client.id, text: 'A hook', category: 'CURIOSITY', source: 'CUSTOM' } });
      const rule = await prisma.automationRule.create({ data: { accountId: A.account.id, name: 'A rule', keyword: 'k' } });
      const post = await prisma.scheduledPost.create({ data: { accountId: A.account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: '[]', scheduledAt: new Date(Date.now() + 86_400_000) } });
      const probes: [string, string, string, string, object?][] = [
        ['get', `/preflight/${check.id}`, '/preflight/nope-nope', 'check'], ['get', `/preflight/${check.id}/brain`, '/preflight/nope-nope/brain', 'brain'],
        ['delete', `/preflight/${check.id}`, '/preflight/nope-nope', 'del-check'], ['patch', `/drafts/${draft.id}`, '/drafts/nope-nope', 'draft', {}],
        ['delete', `/drafts/${draft.id}`, '/drafts/nope-nope', 'del-draft'], ['patch', `/ideas/${idea.id}`, '/ideas/nope-nope', 'idea', { status: 'SAVED' }],
        ['delete', `/ideas/${idea.id}`, '/ideas/nope-nope', 'del-idea'], ['patch', `/hooks/${hook.id}/favorite`, '/hooks/nope-nope/favorite', 'hook'],
        ['patch', `/posts/${post.id}`, '/posts/nope-nope', 'post', { caption: 'x' }], ['delete', `/posts/${post.id}`, '/posts/nope-nope', 'del-post'],
        ['delete', `/automations/${rule.id}`, '/automations/nope-nope', 'del-rule'],
      ];
      try {
        for (const [method, theirs, nothing, label, body] of probes) {
          const t = await (http() as any)[method](theirs).set(bearer(B.token)).send(body ?? {});
          const n = await (http() as any)[method](nothing).set(bearer(B.token)).send(body ?? {});
          expect([label, t.status, t.body.message]).toEqual([label, n.status, n.body.message]); // 404, or the same quiet 204 a delete of a missing id gives
        }
        // Nothing of A's was touched by any of those.
        expect(await prisma.contentCheck.count({ where: { id: check.id } })).toBe(1);
        expect(await prisma.postDraft.count({ where: { id: draft.id } })).toBe(1);
        expect(await prisma.contentIdea.findUniqueOrThrow({ where: { id: idea.id } })).toMatchObject({ status: 'NEW' });
        expect(await prisma.scheduledPost.count({ where: { id: post.id } })).toBe(1);
        expect(await prisma.automationRule.count({ where: { id: rule.id } })).toBe(1);
        expect(await prisma.hook.findUniqueOrThrow({ where: { id: hook.id } })).toMatchObject({ isFavorite: false });
      } finally {
        await prisma.automationRule.delete({ where: { id: rule.id } }).catch(() => undefined);
        await prisma.scheduledPost.deleteMany({ where: { id: post.id } });
        await prisma.contentIdea.deleteMany({ where: { id: idea.id } });
        await prisma.hook.deleteMany({ where: { id: hook.id } });
      }
    });

    it('ignores any client or user id sent in a request body', async () => {
      const draft = (await http().post('/drafts').set(bearer(A.token)).send({ caption: 'x', clientId: B.client.id, userId: B.user.id })).body;
      expect(draft).toMatchObject({ clientId: A.client.id, userId: A.user.id });
      const post = (await http().post('/posts').set(bearer(A.token)).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: [], scheduledAt: soon(), clientId: B.client.id, createdById: B.user.id, status: 'PUBLISHED' }).expect(201)).body;
      expect(post).toMatchObject({ createdById: A.user.id, status: 'SCHEDULED' });
      const asClient = await http().put('/brand-profile').set(bearer(A.token)).send({ niche: 'Hardening niche', clientId: B.client.id, userId: B.user.id }).expect(200);
      expect(asClient.body.clientId).toBe(A.client.id);
      expect(await prisma.brandProfile.count({ where: { clientId: B.client.id } })).toBe(0);
      await prisma.brandProfile.deleteMany({ where: { clientId: A.client.id } });
      await prisma.scheduledPost.deleteMany({ where: { id: post.id } });
    });

    it('CORS: a browser at the web app\'s address may send the act-as headers, and other addresses get nothing', async () => {
      // main.ts calls app.enableCors({ origin: FRONTEND_URL.split(',') }); this runs the same call on a bare app.
      const bare = (await Test.createTestingModule({}).compile()).createNestApplication();
      bare.enableCors({ origin: ['http://localhost:3000'] });
      await bare.init();
      try {
        const asked = 'authorization,content-type,x-client-id,x-preview-mode';
        const ok = await request(bare.getHttpServer()).options('/anything').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', asked);
        expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(ok.headers['access-control-allow-headers']).toContain('x-client-id');
        expect(ok.headers['access-control-allow-headers']).toContain('x-preview-mode');
        const evil = await request(bare.getHttpServer()).options('/anything').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', asked);
        expect(evil.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await bare.close();
      }
    });
  });
});
