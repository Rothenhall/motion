import { mkdirSync, mkdtempSync, existsSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaService } from '../src/prisma.service';
import { UploadsCleanupService } from '../src/uploads-cleanup.service';

const DAY = 86_400_000;

describe('Upload cleanup', () => {
  const prisma = new PrismaService();
  const cleanup = new UploadsCleanupService(prisma);
  let dir: string;

  /** Writes a file the way the uploader names them, last touched `ageDays` ago. */
  const upload = (name: string, ageDays: number) => {
    writeFileSync(join(dir, name), 'x');
    const when = new Date(Date.now() - ageDays * DAY);
    utimesSync(join(dir, name), when, when);
    return name;
  };
  const url = (name: string, host = 'https://tunnel.example.dev') => `${host}/media/${name}`;

  beforeAll(async () => {
    await prisma.$connect();
    const client = await prisma.client.create({ data: { name: 'Cleanup test client' } });
    const user = await prisma.user.create({ data: { email: 'cleanup@example.com', passwordHash: 'x', clientId: client.id } });
    const account = await prisma.socialAccount.create({ data: { userId: user.id, clientId: client.id, provider: 'instagram', externalId: 'cleanup-ig', accessToken: 'x' } });
    await prisma.scheduledPost.create({ data: { accountId: account.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: JSON.stringify([url('1000-aaaaaaaa.jpg')]), scheduledAt: new Date(), status: 'PUBLISHED' } });
    await prisma.postDraft.create({ data: { userId: user.id, clientId: client.id, mediaUrls: JSON.stringify([url('1000-bbbbbbbb.png', 'http://localhost:3001')]) } });
    await prisma.contentCheck.create({ data: { userId: user.id, clientId: client.id, kind: 'VIDEO', platform: 'instagram', mediaUrls: JSON.stringify([url('1000-cccccccc.mp4')]) } });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'motion-uploads-'));
    delete process.env.UPLOAD_CLEANUP;
    delete process.env.UPLOAD_CLEANUP_DAYS;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  afterAll(async () => {
    delete process.env.UPLOAD_CLEANUP;
    // The test database is shared with the other specs, some of which expect to start with no users: leave nothing behind.
    const user = await prisma.user.findUnique({ where: { email: 'cleanup@example.com' } });
    if (user) {
      await prisma.contentCheck.deleteMany({ where: { userId: user.id } });
      await prisma.postDraft.deleteMany({ where: { userId: user.id } });
      await prisma.scheduledPost.deleteMany({ where: { account: { userId: user.id } } });
      await prisma.socialAccount.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      if (user.clientId) await prisma.client.delete({ where: { id: user.clientId } });
    }
    await prisma.$disconnect();
  });

  it('only reports by default: nothing is deleted until cleanup is switched on', async () => {
    const old = upload('1000-dddddddd.jpg', 30);
    const result = await cleanup.sweep({ dir });
    expect(result.orphans).toEqual([old]);
    expect(result.removed).toBe(0);
    expect(existsSync(join(dir, old))).toBe(true);
  });

  it('removes only old files that nothing points at', async () => {
    process.env.UPLOAD_CLEANUP = 'on';
    const orphan = upload('1000-dddddddd.jpg', 30);
    const young = upload('2000-eeeeeeee.jpg', 2); // uploaded recently: the composer may still be open
    const post = upload('1000-aaaaaaaa.jpg', 90); // used by a published post, which keeps showing it
    const draft = upload('1000-bbbbbbbb.png', 90); // used by a draft, referenced under a different host
    const check = upload('1000-cccccccc.mp4', 90); // used by a pre-flight check
    writeFileSync(join(dir, 'notes.txt'), 'not an upload'); // not named like an upload: never touched
    utimesSync(join(dir, 'notes.txt'), new Date(0), new Date(0));
    mkdirSync(join(dir, '1000-ffffffff.jpg')); // a folder that happens to be named like an upload

    const result = await cleanup.sweep({ dir });
    expect(result).toEqual({ orphans: [orphan], removed: 1 });
    expect(existsSync(join(dir, orphan))).toBe(false);
    for (const kept of [young, post, draft, check, 'notes.txt', '1000-ffffffff.jpg']) expect(existsSync(join(dir, kept))).toBe(true);
  });

  it('honours the grace period setting', async () => {
    process.env.UPLOAD_CLEANUP = 'on';
    process.env.UPLOAD_CLEANUP_DAYS = '60';
    const forty = upload('1000-dddddddd.jpg', 40);
    expect((await cleanup.sweep({ dir })).removed).toBe(0);
    expect(existsSync(join(dir, forty))).toBe(true);
  });
});
