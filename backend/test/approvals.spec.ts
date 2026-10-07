import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { PublishersService } from '../src/publishers.service';
import { SchedulerService } from '../src/scheduler.service';
import { encryptToken, hashPassword, signToken } from '../src/auth/crypto';
import { FeaturesService } from '../src/tenancy/features.service';

/**
 * The approval workflow: a client that requires approval cannot publish by itself. Its posts wait for staff, staff approve or
 * send them back, and the scheduler never touches a post that has not been approved.
 */
describe('Approvals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let features: FeaturesService;
  let scheduler: SchedulerService;
  const pub = { publish: jest.fn(), replyInstagramComment: jest.fn(), replyFacebookComment: jest.fn(), privateReplyInstagram: jest.fn(), privateReplyFacebook: jest.fn() };
  const http = () => request(app.getHttpServer());
  const made = { clients: [] as string[], users: [] as string[], externalIds: [] as string[] };
  const bearer = (token: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  const soon = (hours = 24) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const MEDIA = ['https://cdn.example.com/a.jpg'];

  async function makeClient(label: string, requireApproval: boolean) {
    const client = await prisma.client.create({ data: { name: `Apr ${label}`, requireApproval } });
    made.clients.push(client.id);
    const user = await prisma.user.create({ data: { email: `apr-${label}@example.com`, passwordHash: await hashPassword('password123'), role: Role.CLIENT_POC, clientId: client.id } });
    made.users.push(user.id);
    const externalId = `apr-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    made.externalIds.push(externalId);
    const account = await prisma.socialAccount.create({ data: { clientId: client.id, userId: user.id, provider: 'instagram', externalId, name: `@${label}`, accessToken: encryptToken('token') } });
    return { client, user, token: signToken(user.id, 'session', 3600), account };
  }
  type World = Awaited<ReturnType<typeof makeClient>>;

  let staff: { id: string; token: string };
  let staff2: { id: string; token: string };
  let A: World; // requires approval
  let B: World; // requires approval, a different client
  let C: World; // does not require approval

  const submit = (w: World, extra: Record<string, unknown> = {}, as = w.token) =>
    http().post('/posts').set(bearer(as)).send({ accountId: w.account.id, platform: 'instagram', mediaUrls: MEDIA, scheduledAt: soon(), caption: 'hello', ...extra });
  const pendingPost = async (w: World = A) => (await submit(w).expect(201)).body.id as string;
  const approve = (id: string, body: Record<string, unknown> = {}, token = staff.token) => http().post(`/admin/approvals/${id}/approve`).set(bearer(token)).send(body);
  const changes = (id: string, ...args: [note?: unknown, token?: string]) => http().post(`/admin/approvals/${id}/request-changes`).set(bearer(args[1] ?? staff.token)).send(args.length ? { note: args[0] } : { note: 'Please shorten the caption' });
  const row = (id: string) => prisma.scheduledPost.findUniqueOrThrow({ where: { id } });
  const actions = async (clientId: string) => (await prisma.adminAuditLog.findMany({ where: { clientId, action: { startsWith: 'approval.' } }, orderBy: { at: 'asc' } })).map((e) => e.action);
  const tickFor = async (id: string) => {
    pub.publish.mockClear();
    await scheduler.tick();
    return pub.publish.mock.calls.some((c) => c[0] === id);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PublishersService).useValue(pub).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    features = app.get(FeaturesService);
    scheduler = app.get(SchedulerService);

    const mkStaff = async (email: string) => {
      const home = await prisma.client.create({ data: { name: `Apr staff home ${email}` } });
      made.clients.push(home.id);
      const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword('password123'), role: Role.ADMIN, clientId: home.id } });
      made.users.push(user.id);
      return { id: user.id, token: signToken(user.id, 'session', 3600) };
    };
    staff = await mkStaff('apr-staff@example.com');
    staff2 = await mkStaff('apr-staff2@example.com');
    A = await makeClient('a', true);
    B = await makeClient('b', true);
    C = await makeClient('c', false);
  });

  afterAll(async () => {
    const extra = await prisma.user.findMany({ where: { email: { startsWith: 'apr-' } }, select: { id: true, clientId: true } });
    const userIds = [...new Set([...made.users, ...extra.map((u) => u.id)])];
    const clientIds = [...new Set([...made.clients, ...extra.map((u) => u.clientId).filter((c): c is string => !!c)])];
    await prisma.scheduledPost.deleteMany({ where: { account: { clientId: { in: clientIds } } } });
    await prisma.socialAccount.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { externalId: { in: made.externalIds } }] } });
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ clientId: { in: clientIds } }, { actorId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await app.close();
  });

  // ---------------------------------------------------------------- the main flow

  describe('the flow', () => {
    it('client submits, staff see it, approve it, and the scheduler then publishes it', async () => {
      const res = await submit(A).expect(201);
      const id = res.body.id as string;
      expect(res.body).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalNote: null, approvalDecidedAt: null });
      expect(res.body).not.toHaveProperty('approvalDecidedById');
      expect(await row(id)).toMatchObject({ createdById: A.user.id });

      const queue = (await http().get('/admin/approvals').set(bearer(staff.token)).expect(200)).body;
      const item = queue.items.find((i: any) => i.id === id);
      expect(item).toMatchObject({
        client: { id: A.client.id, name: 'Apr a' },
        account: { id: A.account.id, provider: 'instagram', name: '@a' },
        platform: 'instagram', mediaType: 'IMAGE', caption: 'hello', mediaUrls: MEDIA,
        submittedBy: { id: A.user.id, email: 'apr-a@example.com' }, approvalStatus: 'PENDING', approvalNote: null, approvalDecidedAt: null, pastDue: false,
      });
      expect(queue.total).toBeGreaterThanOrEqual(1);

      // Nothing publishes it before the decision, even when its time arrives.
      await prisma.scheduledPost.update({ where: { id }, data: { scheduledAt: new Date(Date.now() + 1500) } });
      await new Promise((r) => setTimeout(r, 1700));
      expect(await tickFor(id)).toBe(false);
      await prisma.scheduledPost.update({ where: { id }, data: { scheduledAt: new Date(Date.now() + 3_600_000) } });

      const done = (await approve(id).expect(200)).body;
      expect(done).toMatchObject({ id, approvalStatus: 'APPROVED' });
      expect(await row(id)).toMatchObject({ status: 'SCHEDULED', approvalStatus: 'APPROVED', approvalDecidedById: staff.id, approvalNote: null });
      expect((await http().get('/admin/approvals').set(bearer(staff.token)).expect(200)).body.items.map((i: any) => i.id)).not.toContain(id);

      await prisma.scheduledPost.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      expect(await tickFor(id)).toBe(true);
      expect(await row(id)).toMatchObject({ status: 'PUBLISHING' });
    });

    it('request changes, then edit, resubmit, approve', async () => {
      const id = await pendingPost();
      const res = (await changes(id, '  Please shorten the caption  ').expect(200)).body;
      expect(res).toMatchObject({ approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Please shorten the caption' });
      expect(await row(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'CHANGES_REQUESTED' });
      expect((await http().get('/admin/approvals').set(bearer(staff.token)).expect(200)).body.items.map((i: any) => i.id)).not.toContain(id);
      // The client sees the note in the normal post list.
      const mine = (await http().get('/posts').set(bearer(A.token)).expect(200)).body.find((p: any) => p.id === id);
      expect(mine).toMatchObject({ approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Please shorten the caption' });
      await approve(id).expect(409); // waiting for the client, not for staff

      // Editing a post that needs changes sends it back to the queue, with the note cleared.
      const edited = (await http().patch(`/posts/${id}`).set(bearer(A.token)).send({ caption: 'shorter' }).expect(200)).body;
      expect(edited).toMatchObject({ caption: 'shorter', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalNote: null, approvalDecidedAt: null });
      await approve(id).expect(200);

      // The other way back: request changes again and use the resubmit button instead of an edit.
      const id2 = await pendingPost();
      await changes(id2).expect(200);
      const re = (await http().post(`/posts/${id2}/resubmit`).set(bearer(A.token)).expect(200)).body;
      expect(re).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalNote: null });
      await http().post(`/posts/${id2}/resubmit`).set(bearer(A.token)).expect(400); // no longer waiting on the client
      await approve(id2).expect(200);
    });

    it('editing an approved post that has not been published sends it back', async () => {
      const id = await pendingPost();
      await approve(id).expect(200);
      const edited = (await http().patch(`/posts/${id}`).set(bearer(A.token)).send({ caption: 'sneaky change' }).expect(200)).body;
      expect(edited).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalDecidedAt: null });
      expect(await tickFor(id)).toBe(false);
    });

    it('editing or resubmitting a published post stays forbidden', async () => {
      const id = await pendingPost();
      await prisma.scheduledPost.update({ where: { id }, data: { status: 'PUBLISHED', approvalStatus: 'APPROVED' } });
      await http().patch(`/posts/${id}`).set(bearer(A.token)).send({ caption: 'late' }).expect(400);
      await http().post(`/posts/${id}/resubmit`).set(bearer(A.token)).expect(400);
    });

    it('a client that does not require approval is unaffected', async () => {
      const res = await submit(C).expect(201);
      expect(res.body).toMatchObject({ status: 'SCHEDULED', approvalStatus: null });
      const edited = (await http().patch(`/posts/${res.body.id}`).set(bearer(C.token)).send({ caption: 'fine' }).expect(200)).body;
      expect(edited).toMatchObject({ status: 'SCHEDULED', approvalStatus: null });
      await http().post(`/posts/${res.body.id}/resubmit`).set(bearer(C.token)).expect(400);
      await approve(res.body.id).expect(409);
      await prisma.scheduledPost.update({ where: { id: res.body.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
      expect(await tickFor(res.body.id)).toBe(true);
    });

    it('staff bypass approval in every mode, and stay the author', async () => {
      const acting = bearer(staff.token, { 'X-Client-Id': A.client.id });
      const res = await http().post('/posts').set(acting).send({ accountId: A.account.id, platform: 'instagram', mediaUrls: MEDIA, scheduledAt: soon() }).expect(201);
      expect(res.body).toMatchObject({ status: 'SCHEDULED', approvalStatus: null });
      expect(await row(res.body.id)).toMatchObject({ createdById: staff.id });
      const edited = (await http().patch(`/posts/${res.body.id}`).set(acting).send({ caption: 'staff edit' }).expect(200)).body;
      expect(edited).toMatchObject({ status: 'SCHEDULED', approvalStatus: null });
      // Staff editing a post that waits for review leaves the review state alone.
      const pending = await pendingPost();
      const staffEdit = (await http().patch(`/posts/${pending}`).set(acting).send({ caption: 'staff touch' }).expect(200)).body;
      expect(staffEdit).toMatchObject({ caption: 'staff touch', status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
    });

    it('turning the requirement on also covers edits to posts scheduled before it', async () => {
      const w = await makeClient('late', false);
      const id = (await submit(w).expect(201)).body.id as string;
      await prisma.client.update({ where: { id: w.client.id }, data: { requireApproval: true } });
      const edited = (await http().patch(`/posts/${id}`).set(bearer(w.token)).send({ caption: 'now reviewed' }).expect(200)).body;
      expect(edited).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
    });
  });

  // ---------------------------------------------------------------- security

  describe('a client can never decide its own posts', () => {
    const hostile = { status: 'SCHEDULED', approvalStatus: 'APPROVED', approvalNote: 'ok', approvalDecidedAt: new Date().toISOString(), approvalDecidedById: 'someone', createdById: 'someone' };

    it('ignores status and approval fields on create and edit', async () => {
      const res = await submit(A, hostile).expect(201);
      expect(res.body).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalNote: null, approvalDecidedAt: null });
      expect(await row(res.body.id)).toMatchObject({ createdById: A.user.id, approvalDecidedById: null });

      const edited = (await http().patch(`/posts/${res.body.id}`).set(bearer(A.token)).send({ caption: 'edit', ...hostile }).expect(200)).body;
      expect(edited).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalNote: null });
      await http().patch(`/posts/${res.body.id}`).set(bearer(A.token)).send(hostile).expect(400); // nothing editable in it
      expect(await row(res.body.id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING', approvalDecidedById: null });

      // Same on a post that staff sent back, and on one that was approved.
      await changes(res.body.id).expect(200);
      await http().patch(`/posts/${res.body.id}`).set(bearer(A.token)).send({ caption: 'x', ...hostile }).expect(200);
      expect(await row(res.body.id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
    });

    it('cannot reach any staff route, and staff routes look absent to clients', async () => {
      const id = await pendingPost();
      for (const token of [A.token, C.token]) {
        await approve(id, {}, token).expect(404);
        await changes(id, 'a note', token).expect(404);
        await http().get('/admin/approvals').set(bearer(token)).expect(404);
        await http().get('/admin/approvals/count').set(bearer(token)).expect(404);
        await http().get(`/admin/clients/${A.client.id}/approvals`).set(bearer(token)).expect(404);
      }
      expect(await row(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
    });

    it('cannot switch approval off for itself', async () => {
      await http().patch(`/admin/clients/${A.client.id}`).set(bearer(A.token)).send({ requireApproval: false }).expect(404);
      expect((await prisma.client.findUniqueOrThrow({ where: { id: A.client.id } })).requireApproval).toBe(true);
    });

    it("another client's posts answer 404 on edit and resubmit, and are not listed", async () => {
      const bId = await pendingPost(B);
      await changes(bId).expect(200);
      await http().patch(`/posts/${bId}`).set(bearer(A.token)).send({ caption: 'hijack' }).expect(404);
      await http().post(`/posts/${bId}/resubmit`).set(bearer(A.token)).expect(404);
      expect(await row(bId)).toMatchObject({ approvalStatus: 'CHANGES_REQUESTED' });
      expect((await http().get('/posts').set(bearer(A.token)).expect(200)).body.map((p: any) => p.id)).not.toContain(bId);
    });

    it('a staff member acting as a client in view mode cannot resubmit or approve through the client app', async () => {
      const id = await pendingPost();
      await changes(id).expect(200);
      await http().post(`/posts/${id}/resubmit`).set(bearer(staff.token, { 'X-Client-Id': A.client.id, 'X-Preview-Mode': 'view' })).expect(403);
    });
  });

  describe('deciding', () => {
    it('cannot approve twice, or approve something already sent back', async () => {
      const id = await pendingPost();
      await approve(id).expect(200);
      const again = await approve(id).expect(409);
      expect(again.body.code).toBe('NOT_PENDING');
      expect((await changes(id).expect(409)).body.code).toBe('NOT_PENDING');
    });

    it('two staff approving at once produce exactly one success', async () => {
      const id = await pendingPost();
      const results = await Promise.all([approve(id, {}, staff.token), approve(id, {}, staff2.token), approve(id, {}, staff.token)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await actions(A.client.id)).toEqual(expect.arrayContaining(['approval.approve']));
      expect(await prisma.adminAuditLog.count({ where: { action: 'approval.approve', targetId: id } })).toBe(1);
    });

    it('an approve and a request-changes at once leave one decision', async () => {
      const id = await pendingPost();
      const results = await Promise.all([approve(id), changes(id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('a post that is not there answers 404', async () => {
      await approve('no-such-post').expect(404);
      await changes('no-such-post').expect(404);
    });

    it('approving a past-due post needs a new future time', async () => {
      const id = await pendingPost();
      await prisma.scheduledPost.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 60_000) } });
      const item = (await http().get(`/admin/clients/${A.client.id}/approvals`).set(bearer(staff.token)).expect(200)).body.pending.find((i: any) => i.id === id);
      expect(item.pastDue).toBe(true);
      expect((await approve(id).expect(400)).body.code).toBe('SCHEDULE_TIME_PASSED');
      expect((await approve(id, { scheduledAt: new Date(Date.now() - 1000).toISOString() }).expect(400)).body.code).toBe('SCHEDULE_TIME_PASSED');
      await approve(id, { scheduledAt: 'garbage' }).expect(400);
      expect(await row(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });

      const when = new Date(Date.now() + 7_200_000);
      await approve(id, { scheduledAt: when.toISOString() }).expect(200);
      expect(await row(id)).toMatchObject({ status: 'SCHEDULED', approvalStatus: 'APPROVED', scheduledAt: when });
      const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'approval.approve', targetId: id } });
      expect(log.meta).toMatchObject({ postId: id, scheduledAt: when.toISOString(), rescheduled: true });
    });

    it('a later time can also be chosen for a post that is not past due', async () => {
      const id = await pendingPost();
      const when = new Date(Date.now() + 5 * 86_400_000);
      await approve(id, { scheduledAt: when.toISOString() }).expect(200);
      expect((await row(id)).scheduledAt).toEqual(when);
    });

    it('request-changes needs a note of 3 to 500 characters', async () => {
      const id = await pendingPost();
      for (const note of [undefined, '', '  ab  ', 'x'.repeat(501)]) await changes(id, note).expect(400);
      await http().post(`/admin/approvals/${id}/request-changes`).set(bearer(staff.token)).send({ note: 123 }).expect(400);
      expect(await row(id)).toMatchObject({ approvalStatus: 'PENDING' });
      await changes(id, 'x'.repeat(500)).expect(200);
    });

    it('resubmit needs the same switches as scheduling', async () => {
      const id = await pendingPost();
      await changes(id).expect(200);
      await features.set(A.client.id, 'schedule', false);
      try {
        const res = await http().post(`/posts/${id}/resubmit`).set(bearer(A.token)).expect(403);
        expect(res.body).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'schedule' });
      } finally {
        await features.set(A.client.id, 'schedule', true);
      }
      await http().post(`/posts/${id}/resubmit`).set(bearer(A.token)).expect(200);
    });

    it('suspended clients stay blocked', async () => {
      const w = await makeClient('susp', true);
      const id = await pendingPost(w);
      await changes(id).expect(200);
      await prisma.client.update({ where: { id: w.client.id }, data: { status: 'SUSPENDED' } });
      expect((await http().post(`/posts/${id}/resubmit`).set(bearer(w.token)).expect(403)).body.code).toBe('CLIENT_SUSPENDED');
    });
  });

  describe('channel disconnected', () => {
    it('cannot approve a post whose channel was disconnected, but can send it back', async () => {
      const w = await makeClient('disc', true);
      const id = await pendingPost(w);
      await http().delete(`/accounts/${w.account.id}`).set(bearer(staff.token, { 'X-Client-Id': w.client.id })).expect(200);
      const res = await approve(id).expect(400);
      expect(res.body.code).toBe('CHANNEL_DISCONNECTED');
      expect(await row(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
      await changes(id, 'Choose another channel').expect(200);
    });

    it('a new post cannot be sent to a disconnected channel', async () => {
      const w = await makeClient('disc2', true);
      await prisma.socialAccount.update({ where: { id: w.account.id }, data: { disconnectedAt: new Date() } });
      await submit(w).expect(400);
    });
  });

  // ---------------------------------------------------------------- the scheduler

  describe('the scheduler', () => {
    it('never publishes a post that waits for a decision, even when its time has passed', async () => {
      const pending = await pendingPost();
      const sentBack = await pendingPost();
      await changes(sentBack).expect(200);
      await prisma.scheduledPost.updateMany({ where: { id: { in: [pending, sentBack] } }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
      pub.publish.mockClear();
      await scheduler.tick();
      expect(pub.publish.mock.calls.map((c) => c[0])).not.toEqual(expect.arrayContaining([pending]));
      expect(pub.publish.mock.calls.map((c) => c[0])).not.toEqual(expect.arrayContaining([sentBack]));
      expect(await row(pending)).toMatchObject({ status: 'PENDING_APPROVAL' });
      expect(await row(sentBack)).toMatchObject({ status: 'PENDING_APPROVAL' });
    });

    it('does not claim a SCHEDULED post whose approval is still open (defence in depth)', async () => {
      const id = await pendingPost();
      await prisma.scheduledPost.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 1000) } });
      expect(await tickFor(id)).toBe(false);
      expect(await row(id)).toMatchObject({ status: 'SCHEDULED' });
    });
  });

  // ---------------------------------------------------------------- counts and shapes

  describe('counts', () => {
    it('keep scheduled counts accurate and show what awaits approval', async () => {
      const w = await makeClient('count', true);
      const p1 = await pendingPost(w);
      await pendingPost(w);
      const p3 = await pendingPost(w);
      await approve(p3).expect(200);
      expect(p1).toBeTruthy();

      const dash = (await http().get('/dashboard').set(bearer(w.token)).expect(200)).body;
      expect(dash.stats).toMatchObject({ scheduled: 1, awaitingApproval: 2, failed: 0 });
      expect(dash.upcomingPosts.map((p: any) => p.id)).toEqual([p3]);
      expect(dash.upcomingPosts[0]).not.toHaveProperty('approvalDecidedById');

      expect((await http().get(`/admin/clients/${w.client.id}`).set(bearer(staff.token)).expect(200)).body).toMatchObject({ requireApproval: true, pendingApprovals: 2, scheduledPosts: 1 });
      const list = (await http().get('/admin/clients').set(bearer(staff.token)).expect(200)).body.find((c: any) => c.id === w.client.id);
      expect(list).toMatchObject({ requireApproval: true, pendingApprovals: 2, scheduledPosts: 1 });

      const overview = (await http().get('/admin/overview').set(bearer(staff.token)).expect(200)).body;
      expect(overview.approvals.pending).toBeGreaterThanOrEqual(2);
      expect(overview.attention.find((a: any) => a.clientId === w.client.id).reasons).toContain('2 posts awaiting approval');
      const count = (await http().get('/admin/approvals/count').set(bearer(staff.token)).expect(200)).body;
      expect(count.pending).toBe(overview.approvals.pending);
      expect((await http().get('/admin/approvals').set(bearer(staff.token)).expect(200)).body.total).toBe(count.pending);

      const filtered = (await http().get(`/admin/approvals?clientId=${w.client.id}`).set(bearer(staff.token)).expect(200)).body;
      expect(filtered.total).toBe(2);
      expect(filtered.items.every((i: any) => i.client.id === w.client.id)).toBe(true);
      // Oldest first.
      const times = filtered.items.map((i: any) => new Date(i.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));

      const tab = (await http().get(`/admin/clients/${w.client.id}/approvals`).set(bearer(staff.token)).expect(200)).body;
      expect(tab.pending).toHaveLength(2);
      expect(tab.recent.map((i: any) => i.id)).toEqual([p3]);
      expect(tab.recent[0]).toMatchObject({ approvalStatus: 'APPROVED', pastDue: false });
      await http().get('/admin/clients/no-such-client/approvals').set(bearer(staff.token)).expect(404);
    });

    it('keeps the recent list to 20, newest decision first', async () => {
      const w = await makeClient('recent', true);
      const ids: string[] = [];
      for (let i = 0; i < 22; i++) ids.push(await pendingPost(w));
      for (const id of ids) await changes(id).expect(200);
      const tab = (await http().get(`/admin/clients/${w.client.id}/approvals`).set(bearer(staff.token)).expect(200)).body;
      expect(tab.recent).toHaveLength(20);
      expect(tab.recent[0].id).toBe(ids[21]);
    });

    it("/auth/me tells the composer whether approval is required", async () => {
      expect((await http().get('/auth/me').set(bearer(A.token)).expect(200)).body.client.requireApproval).toBe(true);
      expect((await http().get('/auth/me').set(bearer(C.token)).expect(200)).body.client.requireApproval).toBe(false);
    });

    it('post lists carry the approval fields and never the staff member who decided', async () => {
      const id = await pendingPost();
      await changes(id).expect(200);
      const list = (await http().get('/posts').set(bearer(A.token)).expect(200)).body;
      const mine = list.find((p: any) => p.id === id);
      expect(mine).toMatchObject({ approvalStatus: 'CHANGES_REQUESTED', approvalNote: 'Please shorten the caption' });
      expect(mine.approvalDecidedAt).toBeTruthy();
      for (const p of list) expect(p).not.toHaveProperty('approvalDecidedById');
    });
  });

  describe('the requirement setting', () => {
    it('is switched by staff, audited with old and new value, and must be a boolean', async () => {
      const w = await makeClient('toggle', false);
      const patch = (body: any) => http().patch(`/admin/clients/${w.client.id}`).set(bearer(staff.token)).send(body);
      expect((await patch({ requireApproval: true }).expect(200)).body.requireApproval).toBe(true);
      await patch({ requireApproval: 'false' }).expect(400);
      await patch({ requireApproval: 1 }).expect(400);
      expect((await prisma.client.findUniqueOrThrow({ where: { id: w.client.id } })).requireApproval).toBe(true);
      await patch({ requireApproval: true }).expect(200); // no change, no new entry
      await patch({ name: 'Apr toggle renamed', requireApproval: false }).expect(200);

      const log = await prisma.adminAuditLog.findMany({ where: { clientId: w.client.id }, orderBy: { at: 'asc' } });
      const settings = log.filter((e) => e.action === 'approval.setting');
      expect(settings.map((e) => e.meta)).toEqual([{ requireApproval: true, previous: false }, { requireApproval: false, previous: true }]);
      expect(log.filter((e) => e.action === 'client.update').map((e) => e.meta)).toEqual([{ name: 'Apr toggle renamed' }]);
      expect(log[0].actorId).toBe(staff.id);
    });

    it('turning it off leaves pending posts pending, and new client posts go straight to the schedule', async () => {
      const w = await makeClient('off', true);
      const id = await pendingPost(w);
      await http().patch(`/admin/clients/${w.client.id}`).set(bearer(staff.token)).send({ requireApproval: false }).expect(200);
      expect(await row(id)).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
      expect((await submit(w).expect(201)).body).toMatchObject({ status: 'SCHEDULED', approvalStatus: null });
      // A client edit of the still-pending post keeps it pending.
      expect((await http().patch(`/posts/${id}`).set(bearer(w.token)).send({ caption: 'still waiting' }).expect(200)).body).toMatchObject({ status: 'PENDING_APPROVAL', approvalStatus: 'PENDING' });
      await approve(id).expect(200);
    });
  });

  describe('audit', () => {
    it('records every step against the client, with the post and the note or time', async () => {
      const w = await makeClient('audit', true);
      const id = await pendingPost(w);
      await changes(id, 'Needs a better hook').expect(200);
      await http().post(`/posts/${id}/resubmit`).set(bearer(w.token)).expect(200);
      await approve(id).expect(200);
      const log = (await http().get(`/admin/clients/${w.client.id}/audit`).set(bearer(staff.token)).expect(200)).body.filter((e: any) => e.action.startsWith('approval.')).reverse();
      expect(log.map((e: any) => e.action)).toEqual(['approval.submit', 'approval.request_changes', 'approval.resubmit', 'approval.approve']);
      expect(log.map((e: any) => e.actor.id)).toEqual([w.user.id, staff.id, w.user.id, staff.id]);
      expect(log.every((e: any) => e.targetId === id && e.meta.postId === id)).toBe(true);
      expect(log[1].meta.note).toBe('Needs a better hook');
      expect(log[3].meta.scheduledAt).toBeTruthy();
      // Editing an approved post is a resubmission too.
      await http().patch(`/posts/${id}`).set(bearer(w.token)).send({ caption: 'changed after approval' }).expect(200);
      expect((await actions(w.client.id)).slice(-1)).toEqual(['approval.resubmit']);
    });

    it('staff posts and posts for clients without the requirement write no approval entries', async () => {
      const w = await makeClient('quiet', false);
      await submit(w).expect(201);
      expect(await actions(w.client.id)).toEqual([]);
    });
  });
});
