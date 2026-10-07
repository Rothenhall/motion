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
});
