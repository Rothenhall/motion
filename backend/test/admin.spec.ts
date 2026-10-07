import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { SchedulerService } from '../src/scheduler.service';
import { AutomationsService } from '../src/automations.service';
import { MetaService } from '../src/meta.service';
import { encryptToken, hashPassword, signToken, verifyToken } from '../src/auth/crypto';
import { FeaturesService } from '../src/tenancy/features.service';
import { InvitesService } from '../src/auth/invites.service';

const PASSWORD = 'password123';

/**
 * Staff run client workspaces: they create clients and invite people by link, set what each client can use, pause or
 * archive them, and are the only ones who connect channels. People join, reset and lose access through links and
 * session versions, and a locked or disabled account is shut out at once.
 */
describe('Staff and clients', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let features: FeaturesService;
  const pub = { publish: jest.fn(), replyInstagramComment: jest.fn(async () => ({ id: 'reply-1' })), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn() };
  const http = () => request(app.getHttpServer());
  const made = { clients: [] as string[], users: [] as string[], externalIds: [] as string[] };
  const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  const tokenOf = (url: string) => new URL(url).searchParams.get('token') as string;

  let staff: { id: string; token: string; clientId: string };

  async function makeStaff(email: string) {
    const client = await prisma.client.create({ data: { name: `Staff home ${email}` } });
    made.clients.push(client.id);
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(PASSWORD), role: Role.ADMIN, clientId: client.id } });
    made.users.push(user.id);
    return { id: user.id, token: signToken(user.id, 'session', 3600), clientId: client.id };
  }

  /** A client created the way staff create one, with its main contact signed in. */
  async function newClient(name: string, email: string) {
    const res = await http().post('/admin/clients').set(bearer(staff.token)).send({ name, pocEmail: email }).expect(201);
    made.clients.push(res.body.client.id);
    const accepted = await http().post('/auth/accept-invite').send({ token: tokenOf(res.body.invite.url), password: PASSWORD }).expect(200);
    made.users.push(accepted.body.user.id);
    return { client: res.body.client, id: accepted.body.user.id as string, token: accepted.body.token as string, email };
  }

  async function channel(clientId: string, label: string) {
    const externalId = `adm-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    made.externalIds.push(externalId);
    return prisma.socialAccount.create({ data: { clientId, provider: 'instagram', externalId, name: `@${label}`, accessToken: encryptToken('token') } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    features = app.get(FeaturesService);
    staff = await makeStaff('adm-staff@example.com');
  });

  afterAll(async () => {
    // The test database is shared with specs that expect to start with no users: leave nothing behind.
    const extra = await prisma.user.findMany({ where: { email: { startsWith: 'adm-' } }, select: { id: true, clientId: true } });
    const userIds = [...new Set([...made.users, ...extra.map((u) => u.id)])];
    const clientIds = [...new Set([...made.clients, ...extra.map((u) => u.clientId).filter((c): c is string => !!c)])];
    await prisma.socialAccount.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { externalId: { in: made.externalIds } }] } });
    await prisma.contentCheck.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.postDraft.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.contentIdea.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.hook.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.brandProfile.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { actorId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------- sign-up

  describe('sign-up', () => {
    it('is closed unless ALLOW_SIGNUP=true, because people join by invitation', async () => {
      const was = process.env.ALLOW_SIGNUP;
      delete process.env.ALLOW_SIGNUP;
      try {
        const res = await http().post('/auth/register').send({ email: 'adm-nosignup@example.com', password: PASSWORD }).expect(403);
        expect(res.body.message).toContain('invitation');
        expect(await prisma.user.findUnique({ where: { email: 'adm-nosignup@example.com' } })).toBeNull();
      } finally {
        if (was === undefined) delete process.env.ALLOW_SIGNUP;
        else process.env.ALLOW_SIGNUP = was;
      }
    });
  });

  // ---------------------------------------------------------------- inviting a client

  describe('creating a client and inviting its contact', () => {
    it('makes the client, invites the contact, and hands staff a link to send', async () => {
      const res = await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Bakery', pocEmail: 'Adm-Baker@Example.com' }).expect(201);
      made.clients.push(res.body.client.id);
      expect(res.body.client).toMatchObject({ name: 'Adm Bakery', status: 'ACTIVE', seatLimit: 3, seatsUsed: 1, pendingInvites: 1 });
      expect(res.body.invite).toMatchObject({ email: 'adm-baker@example.com' });
      expect(res.body.invite.url).toContain('/accept-invite?token=');

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-baker@example.com' } });
      made.users.push(user.id);
      expect(user).toMatchObject({ role: 'CLIENT_POC', status: 'INVITED', clientId: res.body.client.id });
      expect(user.passwordHash).not.toMatch(/^scrypt\$/); // no password to guess yet
      // The database holds a hash of the link, never the link itself.
      const row = await prisma.authToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.tokenHash).not.toContain(tokenOf(res.body.invite.url));
      expect((await features.forClient(res.body.client.id)).ai).toBe(false); // clients an agency creates start without AI

      const log = (await http().get(`/admin/clients/${res.body.client.id}/audit`).set(bearer(staff.token)).expect(200)).body;
      expect(log.map((e: any) => e.action)).toEqual(expect.arrayContaining(['client.create', 'user.invite']));
      expect(log[0].actor.email).toBe('adm-staff@example.com');
    });

    it('rejects bad input and taken emails without leaving a half-made client', async () => {
      const before = await prisma.client.count();
      await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'x', pocEmail: 'adm-x@example.com' }).expect(400);
      await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Fine', pocEmail: 'not-an-email' }).expect(400);
      await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Fine', pocEmail: 'adm-staff@example.com' }).expect(409);
      expect(await prisma.client.count()).toBe(before);
    });

    it('lets the invited person set a password once, and only once', async () => {
      const res = await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Florist', pocEmail: 'adm-florist@example.com' }).expect(201);
      made.clients.push(res.body.client.id);
      const token = tokenOf(res.body.invite.url);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-florist@example.com' } });
      made.users.push(user.id);

      // Looking at the link does not use it up, and shows whose it is.
      for (let i = 0; i < 2; i++) {
        expect((await http().post('/auth/accept-invite/validate').send({ token }).expect(200)).body).toEqual({ email: 'adm-florist@example.com', clientName: 'Adm Florist', role: 'CLIENT_POC' });
      }
      await http().post('/auth/login').send({ email: 'adm-florist@example.com', password: PASSWORD }).expect(401); // cannot sign in before accepting
      await http().post('/auth/accept-invite').send({ token, password: 'short' }).expect(400);

      const joined = await http().post('/auth/accept-invite').send({ token, password: PASSWORD }).expect(200);
      expect(joined.body.user).toMatchObject({ email: 'adm-florist@example.com', role: 'CLIENT_POC' });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: 'ACTIVE' });
      const me = (await http().get('/auth/me').set(bearer(joined.body.token)).expect(200)).body;
      expect(me).toMatchObject({ role: 'CLIENT_POC', canActAs: false, client: { id: res.body.client.id, name: 'Adm Florist' } });

      const again = await http().post('/auth/accept-invite').send({ token, password: 'another-password' }).expect(404);
      expect(again.body.code).toBe('INVITE_INVALID');
      await http().post('/auth/accept-invite/validate').send({ token }).expect(404);
      await http().post('/auth/login').send({ email: 'adm-florist@example.com', password: PASSWORD }).expect(200);
    });

    it('answers every bad link the same way: wrong, expired, or belonging to a disabled user', async () => {
      const c = await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Garage', pocEmail: 'adm-garage@example.com' }).expect(201);
      made.clients.push(c.body.client.id);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-garage@example.com' } });
      made.users.push(user.id);
      const token = tokenOf(c.body.invite.url);

      for (const bad of ['', 'garbage', 'x'.repeat(500), token + 'x']) {
        expect((await http().post('/auth/accept-invite/validate').send({ token: bad }).expect(404)).body.code).toBe('INVITE_INVALID');
      }
      await prisma.authToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await http().post('/auth/accept-invite/validate').send({ token }).expect(404)).body.code).toBe('INVITE_INVALID');
      expect((await http().post('/auth/accept-invite').send({ token, password: PASSWORD }).expect(404)).body.code).toBe('INVITE_INVALID');

      // A fresh link stops working the moment the person is disabled.
      const link = (await http().post(`/admin/users/${user.id}/resend-invite`).set(bearer(staff.token)).expect(200)).body.invite;
      await http().post(`/admin/users/${user.id}/disable`).set(bearer(staff.token)).expect(200);
      await http().post('/auth/accept-invite').send({ token: tokenOf(link.url), password: PASSWORD }).expect(404);
    });

    it('two people holding the same link cannot both use it', async () => {
      const c = await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Race Co', pocEmail: 'adm-race@example.com' }).expect(201);
      made.clients.push(c.body.client.id);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-race@example.com' } });
      made.users.push(user.id);
      const token = tokenOf(c.body.invite.url);
      const invites = app.get(InvitesService);
      const results = await Promise.all([invites.redeem(token, 'INVITE', PASSWORD), invites.redeem(token, 'INVITE', 'a-different-password')]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await prisma.authToken.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1);
    });

    it('a new invitation cancels the old one', async () => {
      const c = await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Studio', pocEmail: 'adm-studio@example.com' }).expect(201);
      made.clients.push(c.body.client.id);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-studio@example.com' } });
      made.users.push(user.id);
      const resent = (await http().post(`/admin/users/${user.id}/resend-invite`).set(bearer(staff.token)).expect(200)).body.invite;
      await http().post('/auth/accept-invite/validate').send({ token: tokenOf(c.body.invite.url) }).expect(404);
      await http().post('/auth/accept-invite/validate').send({ token: tokenOf(resent.url) }).expect(200);
    });
  });

  // ---------------------------------------------------------------- passwords and sessions

  describe('passwords, resets and sessions', () => {
    it('a reset link sets a new password and signs out every older session', async () => {
      const c = await newClient('Adm Reset Co', 'adm-reset@example.com');
      await http().get('/auth/me').set(bearer(c.token)).expect(200);
      await http().post(`/admin/users/${c.id}/resend-invite`).set(bearer(staff.token)).expect(400); // already joined

      const link = (await http().post(`/admin/users/${c.id}/reset-link`).set(bearer(staff.token)).expect(200)).body.reset;
      expect(link.url).toContain('/reset-password?token=');
      expect((await http().post('/auth/reset-password/validate').send({ token: tokenOf(link.url) }).expect(200)).body).toEqual({ email: c.email });
      await http().post('/auth/reset-password').send({ token: tokenOf(link.url), password: 'short' }).expect(400);

      const reset = await http().post('/auth/reset-password').send({ token: tokenOf(link.url), password: 'a-new-password-1' }).expect(200);
      await http().get('/auth/me').set(bearer(c.token)).expect(401); // the session from before the reset is over
      await http().get('/auth/me').set(bearer(reset.body.token)).expect(200); // the one the reset returns works
      await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(401);
      await http().post('/auth/login').send({ email: c.email, password: 'a-new-password-1' }).expect(200);
      expect((await http().post('/auth/reset-password').send({ token: tokenOf(link.url), password: 'a-new-password-2' }).expect(404)).body.code).toBe('RESET_INVALID');
    });

    it('disabling someone ends their session at once, and enabling brings them back', async () => {
      const c = await newClient('Adm Disable Co', 'adm-disable@example.com');
      await http().get('/posts').set(bearer(c.token)).expect(200);
      await http().post(`/admin/users/${c.id}/disable`).set(bearer(staff.token)).expect(200);
      await http().get('/posts').set(bearer(c.token)).expect(401);
      await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(401);
      const back = (await http().post(`/admin/users/${c.id}/enable`).set(bearer(staff.token)).expect(200)).body;
      expect(back.status).toBe('ACTIVE');
      await http().get('/posts').set(bearer(c.token)).expect(401); // a session from before they were disabled does not come back to life
      await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(200);

      // Someone who never joined goes back to waiting for an invitation, not straight to active.
      const waiting = (await http().post('/admin/clients').set(bearer(staff.token)).send({ name: 'Adm Waiting', pocEmail: 'adm-waiting@example.com' }).expect(201)).body;
      made.clients.push(waiting.client.id);
      const w = await prisma.user.findUniqueOrThrow({ where: { email: 'adm-waiting@example.com' } });
      made.users.push(w.id);
      await http().post(`/admin/users/${w.id}/disable`).set(bearer(staff.token)).expect(200);
      expect((await http().post(`/admin/users/${w.id}/enable`).set(bearer(staff.token)).expect(200)).body.status).toBe('INVITED');
    });

    it('"sign out everywhere" ends every session, including others', async () => {
      const c = await newClient('Adm Everywhere Co', 'adm-everywhere@example.com');
      const other = (await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(200)).body.token;
      await http().post('/auth/logout-all').set(bearer(c.token)).expect(204);
      await http().get('/auth/me').set(bearer(c.token)).expect(401);
      await http().get('/auth/me').set(bearer(other)).expect(401);
      const fresh = (await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(200)).body.token;
      await http().get('/auth/me').set(bearer(fresh)).expect(200);
    });

    it('locks an account after five wrong passwords, even for the right one, then lets them back in', async () => {
      const c = await newClient('Adm Lock Co', 'adm-lock@example.com');
      for (let i = 0; i < 5; i++) await http().post('/auth/login').send({ email: c.email, password: 'wrong-password' }).expect(401);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ lockedUntil: expect.any(Date) });
      const locked = await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(401);
      expect(locked.body.message).toBe('Email or password is incorrect.'); // the same answer as a wrong password, so it reveals nothing

      await prisma.user.update({ where: { id: c.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ failedAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(Date) });

      // A few mistakes then the right password never locks anyone.
      for (let i = 0; i < 4; i++) await http().post('/auth/login').send({ email: c.email, password: 'wrong-password' }).expect(401);
      await http().post('/auth/login').send({ email: c.email, password: PASSWORD }).expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).failedAttempts).toBe(0);
      expect((await http().post('/auth/login').send({ email: 'adm-nobody@example.com', password: PASSWORD }).expect(401)).body.message).toBe('Email or password is incorrect.');
    });
  });

  // ---------------------------------------------------------------- looking after clients

  describe('the admin API', () => {
    it('lists clients with what needs attention, and filters them', async () => {
      const a = await newClient('Adm List Alpha', 'adm-alpha@example.com');
      const b = await newClient('Adm List Beta', 'adm-beta@example.com');
      const ch = await channel(a.client.id, 'alpha');
      await prisma.scheduledPost.create({ data: { accountId: ch.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: '[]', scheduledAt: new Date(Date.now() + 86_400_000), status: 'SCHEDULED' } });
      await prisma.scheduledPost.create({ data: { accountId: ch.id, platform: 'instagram', mediaType: 'IMAGE', mediaUrls: '[]', scheduledAt: new Date(Date.now() - 86_400_000), status: 'FAILED', error: 'boom' } });
      await channel(b.client.id, 'beta').then((c) => prisma.socialAccount.update({ where: { id: c.id }, data: { disconnectedAt: new Date() } }));

      const all = (await http().get('/admin/clients?q=Adm List').set(bearer(staff.token)).expect(200)).body;
      expect(all.map((c: any) => c.name)).toEqual(['Adm List Alpha', 'Adm List Beta']);
      const alpha = all.find((c: any) => c.id === a.client.id);
      expect(alpha).toMatchObject({ scheduledPosts: 1, failedPosts: 1, seatsUsed: 1, pendingInvites: 0, staffWorkspace: false, channels: [{ provider: 'instagram', name: '@alpha' }] });
      expect(alpha.lastActivityAt).not.toBeNull();
      expect(all.find((c: any) => c.id === b.client.id)).toMatchObject({ channels: [], disconnectedChannels: 1 });
      expect((await http().get('/admin/clients?q=zzzz').set(bearer(staff.token)).expect(200)).body).toEqual([]);

      const overview = (await http().get('/admin/overview').set(bearer(staff.token)).expect(200)).body;
      const flagged = overview.attention.find((x: any) => x.clientId === a.client.id);
      expect(flagged.reasons).toEqual(expect.arrayContaining(['1 failed post']));
      expect(overview.attention.find((x: any) => x.clientId === b.client.id).reasons).toEqual(expect.arrayContaining(['1 disconnected channel', 'no channel connected']));
      expect(overview.attention.map((x: any) => x.clientId)).not.toContain(staff.clientId); // staff's own workspace is not a client to look after
      expect(overview.posts.failed).toBeGreaterThanOrEqual(1);
    });

    it('shows a client in detail and changes its name, notes and seat limit with checks', async () => {
      const c = await newClient('Adm Detail Co', 'adm-detail@example.com');
      const detail = (await http().get(`/admin/clients/${c.client.id}`).set(bearer(staff.token)).expect(200)).body;
      expect(detail).toMatchObject({ name: 'Adm Detail Co', features: { planner: true, ai: false } });
      await http().get('/admin/clients/no-such-client').set(bearer(staff.token)).expect(404);

      expect((await http().patch(`/admin/clients/${c.client.id}`).set(bearer(staff.token)).send({ name: 'Adm Detail Renamed', notes: 'Likes mornings' }).expect(200)).body).toMatchObject({ name: 'Adm Detail Renamed', notes: 'Likes mornings' });
      await http().patch(`/admin/clients/${c.client.id}`).set(bearer(staff.token)).send({ name: 'x' }).expect(400);
      await http().patch(`/admin/clients/${c.client.id}`).set(bearer(staff.token)).send({}).expect(400);

      await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 0 }).expect(400);
      await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 2.5 }).expect(400);
      expect((await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 5 }).expect(200)).body.seatLimit).toBe(5);
    });

    it('seat limits hold for invitations, and a freed seat can be used again', async () => {
      const c = await newClient('Adm Seats Co', 'adm-seats@example.com');
      await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 2 }).expect(200);
      const one = await http().post(`/admin/clients/${c.client.id}/invite`).set(bearer(staff.token)).send({ email: 'adm-seat-one@example.com' }).expect(201);
      made.users.push(one.body.user.id);
      expect(one.body.user).toMatchObject({ role: 'CLIENT_MEMBER', status: 'INVITED' });
      const full = await http().post(`/admin/clients/${c.client.id}/invite`).set(bearer(staff.token)).send({ email: 'adm-seat-two@example.com' }).expect(400);
      expect(full.body.code).toBe('SEAT_LIMIT');
      await http().post(`/admin/clients/${c.client.id}/invite`).set(bearer(staff.token)).send({ email: 'ADM-SEAT-ONE@example.com' }).expect(409);
      await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 1 }).expect(400); // 2 are in use

      await http().post(`/admin/users/${one.body.user.id}/disable`).set(bearer(staff.token)).expect(200); // frees a seat
      const two = await http().post(`/admin/clients/${c.client.id}/invite`).set(bearer(staff.token)).send({ email: 'adm-seat-two@example.com' }).expect(201);
      made.users.push(two.body.user.id);
      const blocked = await http().post(`/admin/users/${one.body.user.id}/enable`).set(bearer(staff.token)).expect(400); // and now it is taken
      expect(blocked.body.code).toBe('SEAT_LIMIT');
      const people = (await http().get(`/admin/clients/${c.client.id}/users`).set(bearer(staff.token)).expect(200)).body;
      expect(people.seats).toEqual({ used: 2, limit: 2 });
      expect(people.members.map((m: any) => m.email)).toEqual(expect.arrayContaining(['adm-seats@example.com', 'adm-seat-one@example.com', 'adm-seat-two@example.com']));
      expect(JSON.stringify(people)).not.toContain('passwordHash');
    });

    it('pausing a client shuts its people out immediately; reactivating lets them back', async () => {
      const c = await newClient('Adm Pause Co', 'adm-pause@example.com');
      await http().get('/posts').set(bearer(c.token)).expect(200);
      expect((await http().post(`/admin/clients/${c.client.id}/suspend`).set(bearer(staff.token)).expect(200)).body.status).toBe('SUSPENDED');
      expect((await http().get('/posts').set(bearer(c.token)).expect(403)).body.code).toBe('CLIENT_SUSPENDED');
      expect((await http().get('/admin/clients?status=suspended&q=Adm Pause').set(bearer(staff.token)).expect(200)).body).toHaveLength(1);
      await http().get('/posts').set(bearer(staff.token, { 'X-Client-Id': c.client.id })).expect(200); // staff can still look after it
      expect((await http().post(`/admin/clients/${c.client.id}/activate`).set(bearer(staff.token)).expect(200)).body.status).toBe('ACTIVE');
      await http().get('/posts').set(bearer(c.token)).expect(200);
    });

    it('archiving hides a client and pauses it, never touches staff workspaces, and can be undone', async () => {
      const c = await newClient('Adm Archive Co', 'adm-archive@example.com');
      await http().post(`/admin/clients/${staff.clientId}/archive`).set(bearer(staff.token)).expect(400);
      await http().post(`/admin/clients/${c.client.id}/archive`).set(bearer(staff.token)).expect(200);
      expect((await http().get('/admin/clients?q=Adm Archive').set(bearer(staff.token)).expect(200)).body).toEqual([]);
      expect((await http().get('/admin/clients?status=archived&q=Adm Archive').set(bearer(staff.token)).expect(200)).body).toHaveLength(1);
      await http().get('/posts').set(bearer(staff.token, { 'X-Client-Id': c.client.id })).expect(404); // cannot be acted as
      await http().get('/posts').set(bearer(c.token)).expect(403);
      await http().post(`/admin/clients/${c.client.id}/activate`).set(bearer(staff.token)).expect(400); // restore first
      await http().post(`/admin/clients/${c.client.id}/unarchive`).set(bearer(staff.token)).expect(200);
      await http().post(`/admin/clients/${c.client.id}/activate`).set(bearer(staff.token)).expect(200);
      await http().get('/posts').set(bearer(c.token)).expect(200);
    });

    it('sets switches in bulk, validates them, and logs only real changes', async () => {
      const c = await newClient('Adm Switch Co', 'adm-switch@example.com');
      const t = bearer(staff.token);
      const url = `/admin/clients/${c.client.id}/features`;
      const first = (await http().get(url).set(t).expect(200)).body;
      expect(first.groups.sections).toContain('planner');
      expect(first.groups.actions).toContain('ai');
      expect(first.defaults.ai).toBe(false);

      await http().put(url).set(t).send({}).expect(400);
      await http().put(url).set(t).send({ planner: 'no' }).expect(400);
      await http().put(url).set(t).send({ 'make-coffee': true }).expect(400);
      const changed = (await http().put(url).set(t).send({ planner: false, ai: true, inbox: true }).expect(200)).body;
      expect(changed.features).toMatchObject({ planner: false, ai: true, inbox: true });
      expect((await http().get('/posts').set(bearer(c.token)).expect(403)).body.feature).toBe('planner'); // takes effect at once
      expect((await http().get('/auth/me').set(bearer(c.token)).expect(200)).body.features.ai).toBe(true);

      const log = (await http().get(`/admin/clients/${c.client.id}/audit`).set(t).expect(200)).body.filter((e: any) => e.action === 'feature.set');
      expect(log.map((e: any) => `${e.targetId}=${e.meta.enabled}`).sort()).toEqual(['ai=true', 'planner=false']); // inbox was already on
    });
  });

  // ---------------------------------------------------------------- a client's own team

  describe('a client\'s own team', () => {
    it('the main contact invites and manages members; members and outsiders cannot', async () => {
      const c = await newClient('Adm Team Co', 'adm-team@example.com');
      const other = await newClient('Adm Other Team Co', 'adm-otherteam@example.com');
      const invited = await http().post('/team/invite').set(bearer(c.token)).send({ email: 'adm-member@example.com' }).expect(201);
      made.users.push(invited.body.user.id);
      expect(invited.body.user).toMatchObject({ role: 'CLIENT_MEMBER', status: 'INVITED' });
      const joined = await http().post('/auth/accept-invite').send({ token: tokenOf(invited.body.invite.url), password: PASSWORD }).expect(200);
      expect((await http().get('/team/members').set(bearer(c.token)).expect(200)).body.members.map((m: any) => m.email)).toEqual(expect.arrayContaining(['adm-team@example.com', 'adm-member@example.com']));

      // A member can use the workspace but not manage it.
      await http().get('/posts').set(bearer(joined.body.token)).expect(200);
      expect((await http().get('/team/members').set(bearer(joined.body.token)).expect(403)).body.code).toBe('TEAM_FORBIDDEN');
      await http().post('/team/invite').set(bearer(joined.body.token)).send({ email: 'adm-sneaky@example.com' }).expect(403);

      // The contact can pause and restore members, but only in their own client, and never themselves or staff.
      await http().post(`/team/users/${invited.body.user.id}/disable`).set(bearer(other.token)).expect(404);
      await http().post(`/team/users/${c.id}/disable`).set(bearer(c.token)).expect(404);
      await http().post(`/team/users/${staff.id}/disable`).set(bearer(c.token)).expect(404);
      await http().post(`/team/users/${invited.body.user.id}/disable`).set(bearer(c.token)).expect(200);
      await http().get('/posts').set(bearer(joined.body.token)).expect(401);
      await http().post(`/team/users/${invited.body.user.id}/enable`).set(bearer(c.token)).expect(200);
      await http().post('/auth/login').send({ email: 'adm-member@example.com', password: PASSWORD }).expect(200);
      expect(await prisma.user.count({ where: { email: 'adm-sneaky@example.com' } })).toBe(0);
    });

    it('seats apply to the contact\'s invitations too', async () => {
      const c = await newClient('Adm Small Team Co', 'adm-small@example.com');
      await http().patch(`/admin/clients/${c.client.id}/seats`).set(bearer(staff.token)).send({ seatLimit: 1 }).expect(200);
      expect((await http().post('/team/invite').set(bearer(c.token)).send({ email: 'adm-nospace@example.com' }).expect(400)).body.code).toBe('SEAT_LIMIT');
    });
  });

  // ---------------------------------------------------------------- connecting channels

  describe('connecting channels is for staff', () => {
    it('clients cannot start a connection, add a channel or disconnect one', async () => {
      const c = await newClient('Adm Connect Co', 'adm-connect@example.com');
      const own = await channel(c.client.id, 'connect');
      await http().get('/auth/instagram/start').set(bearer(c.token)).expect(404);
      await http().post('/accounts').set(bearer(c.token)).send({ provider: 'instagram', externalId: 'x', accessToken: 't' }).expect(404);
      await http().delete(`/accounts/${own.id}`).set(bearer(c.token)).expect(404);
      expect((await http().get('/accounts').set(bearer(c.token)).expect(200)).body.map((a: any) => a.id)).toEqual([own.id]); // they can see what is connected
      expect(await prisma.socialAccount.findUnique({ where: { id: own.id } })).toMatchObject({ disconnectedAt: null });
      await http().post('/auth/exchange').set(bearer(staff.token)).send({ provider: 'instagram', code: 'x' }).expect(404); // the endpoint that exposed raw tokens is gone
    });

    it('staff start a connection for the client they act as, and the state remembers which', async () => {
      const c = await newClient('Adm State Co', 'adm-state@example.com');
      const res = await http().get('/auth/instagram/start').set(bearer(staff.token, { 'X-Client-Id': c.client.id })).expect(200);
      const state = verifyToken(new URL(res.body.url).searchParams.get('state') as string, 'oauth_state');
      expect(state).toMatchObject({ sub: staff.id, provider: 'instagram', clientId: c.client.id });
    });

    it('the redirect back only connects for staff who started it, to the client they chose', async () => {
      const c = await newClient('Adm Callback Co', 'adm-callback@example.com');
      const connect = jest.spyOn(app.get(MetaService), 'connectInstagram').mockResolvedValue({ name: '@callback', imported: 0 });
      try {
        const state = (userId: string, clientId: string) => signToken(userId, 'oauth_state', 60, { provider: 'instagram', clientId });
        const ok = await http().get(`/auth/instagram/callback?code=abc&state=${state(staff.id, c.client.id)}`).expect(302);
        expect(ok.headers.location).toContain('connected=instagram');
        expect(connect).toHaveBeenCalledWith('abc', { userId: staff.id, clientId: c.client.id });

        connect.mockClear();
        // Someone who is not staff (a client user, or staff who have since been demoted) cannot complete it, even with a genuine state.
        for (const sub of [c.id]) expect((await http().get(`/auth/instagram/callback?code=abc&state=${state(sub, c.client.id)}`).expect(302)).headers.location).toContain('error=');
        const demoted = await makeStaff('adm-demoted@example.com');
        await prisma.user.update({ where: { id: demoted.id }, data: { role: 'CLIENT_POC' } });
        expect((await http().get(`/auth/instagram/callback?code=abc&state=${state(demoted.id, c.client.id)}`).expect(302)).headers.location).toContain('error=');
        // A client that no longer exists, or was archived, is refused.
        await prisma.client.update({ where: { id: c.client.id }, data: { archivedAt: new Date() } });
        expect((await http().get(`/auth/instagram/callback?code=abc&state=${state(staff.id, c.client.id)}`).expect(302)).headers.location).toContain('error=');
        expect(connect).not.toHaveBeenCalled();
      } finally {
        connect.mockRestore();
      }
    });

    it('one channel belongs to one client at a time, and a disconnected channel is free again', async () => {
      const a = await newClient('Adm Channel A', 'adm-chan-a@example.com');
      const b = await newClient('Adm Channel B', 'adm-chan-b@example.com');
      const externalId = `adm-shared-${Date.now()}`;
      made.externalIds.push(externalId);
      const add = (clientId: string) => http().post('/accounts').set(bearer(staff.token, { 'X-Client-Id': clientId })).send({ provider: 'instagram', externalId, accessToken: 'token', name: '@shared' });

      const first = await add(a.client.id).expect(201);
      const clash = await add(b.client.id).expect(409);
      expect(clash.body).toMatchObject({ code: 'CHANNEL_ALREADY_CONNECTED' });
      expect(clash.body.message).toContain('Adm Channel A');
      expect(await prisma.socialAccount.count({ where: { externalId } })).toBe(1);

      // The database holds the same rule for two requests that race.
      await expect(prisma.socialAccount.create({ data: { clientId: b.client.id, provider: 'instagram', externalId, accessToken: encryptToken('t') } })).rejects.toMatchObject({ code: 'P2002' });

      await http().delete(`/accounts/${first.body.id}`).set(bearer(staff.token, { 'X-Client-Id': a.client.id })).expect(200);
      const second = await add(b.client.id).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
    });

    it('disconnecting keeps the history, drops the token, and everything stops using the channel', async () => {
      const c = await newClient('Adm Disconnect Co', 'adm-disconnect@example.com');
      const acting = bearer(staff.token, { 'X-Client-Id': c.client.id });
      const ch = await channel(c.client.id, 'disconnect');
      const due = await prisma.scheduledPost.create({ data: { accountId: ch.id, platform: 'instagram', mediaType: 'IMAGE', caption: 'kept', mediaUrls: '[]', scheduledAt: new Date(Date.now() - 1000), status: 'SCHEDULED' } });
      await prisma.automationRule.create({ data: { accountId: ch.id, name: 'r', keyword: 'price', replyMode: 'PUBLIC', publicReply: 'Thanks' } });

      expect((await http().delete(`/accounts/${ch.id}`).set(acting).expect(200)).body.id).toBe(ch.id);
      await http().delete(`/accounts/${ch.id}`).set(acting).expect(404); // already disconnected
      const row = await prisma.socialAccount.findUniqueOrThrow({ where: { id: ch.id } });
      expect(row.disconnectedAt).not.toBeNull();
      expect(row.accessToken).not.toBe(ch.accessToken); // the working token is gone

      expect((await http().get('/accounts').set(bearer(c.token)).expect(200)).body).toEqual([]);
      expect((await http().get(`/admin/clients/${c.client.id}/channels`).set(bearer(staff.token)).expect(200)).body).toMatchObject([{ id: ch.id, connected: false }]);
      expect((await http().get('/posts').set(bearer(c.token)).expect(200)).body.map((p: any) => p.id)).toContain(due.id); // history stays visible
      const when = new Date(Date.now() + 3_600_000).toISOString();
      await http().post('/posts').set(bearer(c.token)).send({ accountId: ch.id, platform: 'instagram', mediaUrls: ['https://cdn.example.com/a.jpg'], scheduledAt: when }).expect(400);
      await http().post('/drafts').set(bearer(c.token)).send({ accountId: ch.id }).expect(400);

      pub.publish.mockClear();
      await app.get(SchedulerService).tick();
      expect(pub.publish).not.toHaveBeenCalledWith(due.id); // nothing goes out on a disconnected channel
      pub.replyInstagramComment.mockClear();
      await app.get(AutomationsService).handleComment({ platform: 'instagram', channelId: ch.externalId, commentId: 'gone-1', senderId: 'someone', text: 'price?', createdAt: new Date() });
      expect(pub.replyInstagramComment).not.toHaveBeenCalled();
      expect(await prisma.commentEvent.count({ where: { accountId: ch.id } })).toBe(0);

      // Connecting the same channel to the same client again brings it back, with its history.
      const again = await http().post('/accounts').set(acting).send({ provider: 'instagram', externalId: ch.externalId, accessToken: 'new-token' }).expect(201);
      expect(again.body.id).toBe(ch.id);
      expect(await prisma.socialAccount.findUniqueOrThrow({ where: { id: ch.id } })).toMatchObject({ disconnectedAt: null });
      await app.get(SchedulerService).tick();
      expect(pub.publish).toHaveBeenCalledWith(due.id);
    });
  });
});
