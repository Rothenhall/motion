import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma.service';
import { MetaService } from '../src/meta.service';
import { hashPassword, signToken } from '../src/auth/crypto';

/** After Meta sends staff back, they land on the client's Channels tab in the admin console. */
describe('OAuth callback redirects', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const made = { clients: [] as string[], users: [] as string[] };
  const http = () => request(app.getHttpServer());
  const frontend = 'http://frontend.test';
  let was: string | undefined;
  let staffId: string;
  let clientId: string;

  const state = (sub: string, client: string, provider = 'instagram') => signToken(sub, 'oauth_state', 60, { provider, clientId: client });
  const location = async (path: string) => (await http().get(path).expect(302)).headers.location as string;

  beforeAll(async () => {
    was = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = frontend;
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const home = await prisma.client.create({ data: { name: 'Redirect staff home' } });
    const client = await prisma.client.create({ data: { name: 'Redirect Co' } });
    made.clients.push(home.id, client.id);
    const staff = await prisma.user.create({ data: { email: 'redir-staff@example.com', passwordHash: await hashPassword('password123'), role: Role.ADMIN, clientId: home.id } });
    made.users.push(staff.id);
    staffId = staff.id;
    clientId = client.id;
  });

  afterAll(async () => {
    if (was === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = was;
    await prisma.adminAuditLog.deleteMany({ where: { OR: [{ clientId: { in: made.clients } }, { actorId: { in: made.users } }] } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.client.deleteMany({ where: { id: { in: made.clients } } });
    await app.close();
  });

  it('success goes to the client\'s Channels tab with the provider and channel name', async () => {
    const connect = jest.spyOn(app.get(MetaService), 'connectInstagram').mockResolvedValue({ name: '@my shop', imported: 0 });
    try {
      const url = new URL(await location(`/auth/instagram/callback?code=abc&state=${state(staffId, clientId)}`));
      expect(url.origin + url.pathname).toBe(`${frontend}/admin/clients/${clientId}`);
      expect(url.searchParams.get('tab')).toBe('channels');
      expect(url.searchParams.get('connected')).toBe('instagram');
      expect(url.searchParams.get('account')).toBe('@my shop');
    } finally {
      connect.mockRestore();
    }
  });

  it('a failed connection returns to the same tab with the reason', async () => {
    const connect = jest.spyOn(app.get(MetaService), 'connectInstagram').mockRejectedValue(new Error('Meta said no.'));
    try {
      const url = new URL(await location(`/auth/instagram/callback?code=abc&state=${state(staffId, clientId)}`));
      expect(url.pathname).toBe(`/admin/clients/${clientId}`);
      expect(url.searchParams.get('tab')).toBe('channels');
      expect(url.searchParams.get('error')).toContain('Meta');
      expect(url.searchParams.get('connected')).toBeNull();
    } finally {
      connect.mockRestore();
    }
  });

  it('cancelling on Meta still finds the client from the signed state', async () => {
    const url = new URL(await location(`/auth/instagram/callback?error=access_denied&state=${state(staffId, clientId)}`));
    expect(url.pathname).toBe(`/admin/clients/${clientId}`);
    expect(url.searchParams.get('error')).toContain('cancelled');
  });

  it('a state we cannot read falls back to the admin home', async () => {
    for (const bad of ['', 'garbage', state(staffId, clientId) + 'x']) {
      const url = new URL(await location(`/auth/instagram/callback?code=abc&state=${bad}`));
      expect(url.pathname).toBe('/admin');
      expect(url.searchParams.get('error')).toContain('expired');
    }
  });

  it('someone who is no longer staff connects nothing', async () => {
    const connect = jest.spyOn(app.get(MetaService), 'connectInstagram');
    try {
      await prisma.user.update({ where: { id: staffId }, data: { role: Role.CLIENT_POC } });
      const url = new URL(await location(`/auth/instagram/callback?code=abc&state=${state(staffId, clientId)}`));
      expect(url.searchParams.get('error')).toContain('expired');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      await prisma.user.update({ where: { id: staffId }, data: { role: Role.ADMIN } });
      connect.mockRestore();
    }
  });
});
