import axios from 'axios';
import { PublishersService } from '../src/publishers.service';
import { MetaService } from '../src/meta.service';

// Meta's app isn't Live yet, so these pin each Graph call to the host, path and
// parameters Meta documents, with axios mocked.
jest.mock('axios');
const ax = axios as jest.Mocked<typeof axios>;

const V = 'v25.0';

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.META_GRAPH_VERSION;
});

/** Who a connected channel would belong to: the user who connected it and the client workspace. */
const OWNER = { userId: 'user-1', clientId: 'client-1' };

describe('PublishersService Graph calls', () => {
  const pub = new PublishersService({} as any);
  pub.sleep = jest.fn().mockResolvedValue(undefined);
  const ig = { externalId: 'ig-1', accessToken: 'ig-token' };
  const th = { externalId: 'th-1', accessToken: 'th-token' };

  it('sends Instagram comment replies, hides and private replies to graph.instagram.com', async () => {
    ax.post.mockResolvedValue({ data: { id: 'x' } });
    await pub.replyInstagramComment('c1', 'thanks', 'tok');
    await pub.hideInstagramComment('c1', true, 'tok');
    await pub.privateReplyInstagram('ig-1', 'c1', 'check your DMs', 'tok');
    expect(ax.post.mock.calls[0]).toEqual([`https://graph.instagram.com/${V}/c1/replies`, { message: 'thanks', access_token: 'tok' }]);
    expect(ax.post.mock.calls[1]).toEqual([`https://graph.instagram.com/${V}/c1`, null, { params: { hide: true, access_token: 'tok' } }]);
    expect(ax.post.mock.calls[2]).toEqual([
      `https://graph.instagram.com/${V}/ig-1/messages`,
      { recipient: { comment_id: 'c1' }, message: { text: 'check your DMs' }, access_token: 'tok' },
    ]);
  });

  it('sends Facebook private replies to the Page messages edge', async () => {
    ax.post.mockResolvedValue({ data: { recipient_id: 'u', message_id: 'm' } });
    await pub.privateReplyFacebook('page-1', 'c1', 'hi', 'page-tok');
    expect(ax.post).toHaveBeenCalledWith(`https://graph.facebook.com/${V}/page-1/messages`, { recipient: { comment_id: 'c1' }, message: { text: 'hi' }, access_token: 'page-tok' });
  });

  it('publishes an Instagram image once its container is FINISHED', async () => {
    ax.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/content_publishing_limit')) return { data: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } };
      return { data: { status_code: ax.get.mock.calls.length > 2 ? 'FINISHED' : 'IN_PROGRESS' } };
    });
    ax.post.mockResolvedValueOnce({ data: { id: 'container-1' } }).mockResolvedValueOnce({ data: { id: 'media-1' } });
    const id = await (pub as any).publishInstagram(ig, 'cap', ['https://cdn.example.com/a.jpg'], 'IMAGE');
    expect(id).toBe('media-1');
    expect(ax.post.mock.calls[0][0]).toBe(`https://graph.instagram.com/${V}/ig-1/media`);
    expect(ax.post.mock.calls[0][1]).toMatchObject({ image_url: 'https://cdn.example.com/a.jpg' });
    expect(ax.post.mock.calls[1]).toEqual([`https://graph.instagram.com/${V}/ig-1/media_publish`, { creation_id: 'container-1', access_token: 'ig-token' }]);
  });

  it('fails instead of publishing when the Instagram container errors', async () => {
    ax.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/content_publishing_limit')) return { data: { data: [] } };
      return { data: { status_code: 'ERROR', status: 'Error: unsupported format' } };
    });
    ax.post.mockResolvedValueOnce({ data: { id: 'container-1' } });
    await expect((pub as any).publishInstagram(ig, 'cap', ['https://cdn.example.com/a.jpg'], 'IMAGE')).rejects.toThrow(/ERROR: Error: unsupported format/);
    expect(ax.post).toHaveBeenCalledTimes(1);
  });

  it('fails instead of publishing when the container never finishes', async () => {
    ax.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/content_publishing_limit')) return { data: { data: [] } };
      return { data: { status_code: 'IN_PROGRESS' } };
    });
    ax.post.mockResolvedValueOnce({ data: { id: 'container-1' } });
    await expect((pub as any).publishInstagram(ig, 'cap', ['https://cdn.example.com/v.mp4'], 'REELS')).rejects.toThrow(/still processing/);
    expect(ax.post).toHaveBeenCalledTimes(1);
  });

  it('refuses non-JPEG images and a used-up daily quota for Instagram', async () => {
    await expect((pub as any).publishInstagram(ig, 'cap', ['https://cdn.example.com/a.png'], 'IMAGE')).rejects.toThrow(/JPEG/);
    ax.get.mockResolvedValue({ data: { data: [{ quota_usage: 100, config: { quota_total: 100 } }] } });
    await expect((pub as any).publishInstagram(ig, 'cap', ['https://cdn.example.com/a.jpg'], 'IMAGE')).rejects.toThrow(/limit of 100/);
    expect(ax.post).not.toHaveBeenCalled();
  });

  it('waits for the Threads container status before publishing', async () => {
    ax.post.mockResolvedValueOnce({ data: { id: 'tc-1' } }).mockResolvedValueOnce({ data: { id: 'thread-1' } });
    ax.get.mockResolvedValueOnce({ data: { status: 'IN_PROGRESS' } }).mockResolvedValueOnce({ data: { status: 'FINISHED' } });
    const id = await (pub as any).publishThreads(th, 'hello', [], 'TEXT');
    expect(id).toBe('thread-1');
    expect(ax.get).toHaveBeenCalledWith('https://graph.threads.net/v1.0/tc-1', { params: { fields: 'status,error_message', access_token: 'th-token' } });
    expect(ax.post.mock.calls[1][0]).toBe('https://graph.threads.net/v1.0/th-1/threads_publish');
  });
});

describe('MetaService token and webhook calls', () => {
  const prisma: any = {
    socialAccount: {
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: any) => ({ id: 'acc-1', ...data })),
      update: jest.fn(async ({ data }: any) => data),
      findMany: jest.fn(),
    },
    scheduledPost: { findMany: jest.fn(async () => []), create: jest.fn() },
  };
  const meta = new MetaService(prisma);

  beforeEach(() => {
    process.env.META_IG_APP_ID = 'ig-app';
    process.env.META_IG_APP_SECRET = 'ig-secret';
    process.env.META_THREADS_APP_ID = 'th-app';
    process.env.META_THREADS_APP_SECRET = 'th-secret';
    process.env.META_THREADS_REDIRECT_URL = 'https://motion.example.com/auth/threads/callback';
    prisma.socialAccount.findFirst.mockResolvedValue(null);
    prisma.socialAccount.create.mockImplementation(async ({ data }: any) => ({ id: 'acc-1', ...data }));
    prisma.scheduledPost.findMany.mockResolvedValue([]);
  });

  it('reads the wrapped Instagram token response and subscribes the account to webhooks', async () => {
    ax.post.mockImplementation(async (url: string) => {
      if (url === 'https://api.instagram.com/oauth/access_token') return { data: { data: [{ access_token: 'short-ig', user_id: '1', permissions: 'x' }] } };
      return { data: { success: true } };
    });
    ax.get.mockImplementation(async (url: string) => {
      if (url === 'https://graph.instagram.com/access_token') return { data: { access_token: 'long-ig', expires_in: 5_184_000 } };
      if (url === 'https://graph.instagram.com/me') return { data: { user_id: '178', username: 'bob' } };
      return { data: { data: [] } };
    });
    await meta.connectInstagram('code', OWNER);
    expect(ax.get).toHaveBeenCalledWith('https://graph.instagram.com/access_token', { params: { grant_type: 'ig_exchange_token', client_secret: 'ig-secret', access_token: 'short-ig' } });
    expect(ax.post).toHaveBeenCalledWith(`https://graph.instagram.com/${V}/me/subscribed_apps`, null, { params: { subscribed_fields: 'comments,messages', access_token: 'long-ig' } });
  });

  it('subscribes every connected Facebook Page to feed and messages webhooks', async () => {
    ax.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'user-tok', expires_in: 5_184_000 } };
      if (url.endsWith('/me/accounts')) return { data: { data: [{ id: 'p1', name: 'Page', access_token: 'page-tok' }] } };
      return { data: {} };
    });
    ax.post.mockResolvedValue({ data: { success: true } });
    await meta.connectFacebook('code', OWNER);
    expect(ax.post).toHaveBeenCalledWith(`https://graph.facebook.com/${V}/p1/subscribed_apps`, null, { params: { subscribed_fields: 'feed,messages', access_token: 'page-tok' } });
  });

  it('still connects when the webhook subscription fails', async () => {
    ax.get.mockImplementation(async (url: string) => {
      if (url.endsWith('/oauth/access_token')) return { data: { access_token: 'user-tok' } };
      return { data: { data: [{ id: 'p1', name: 'Page', access_token: 'page-tok' }] } };
    });
    ax.post.mockRejectedValue(Object.assign(new Error('nope'), { response: { data: { error: { message: 'missing pages_manage_metadata' } } } }));
    await expect(meta.connectFacebook('code', OWNER)).resolves.toEqual({ name: 'Page', count: 1 });
  });

  it('runs Threads login on graph.threads.net with the Threads app credentials', async () => {
    ax.post.mockResolvedValueOnce({ data: { access_token: 'short-th', user_id: '9' } });
    ax.get.mockImplementation(async (url: string) => {
      if (url === 'https://graph.threads.net/access_token') return { data: { access_token: 'long-th', expires_in: 5_184_000 } };
      if (url === 'https://graph.threads.net/v1.0/me') return { data: { id: '9', username: 'bob' } };
      return { data: { data: [] } };
    });
    await meta.connectThreads('the-code', OWNER);
    const [url, form] = ax.post.mock.calls[0] as [string, URLSearchParams];
    expect(url).toBe('https://graph.threads.net/oauth/access_token');
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'th-app',
      client_secret: 'th-secret',
      grant_type: 'authorization_code',
      redirect_uri: 'https://motion.example.com/auth/threads/callback',
      code: 'the-code',
    });
    expect(ax.get).toHaveBeenCalledWith('https://graph.threads.net/access_token', { params: { grant_type: 'th_exchange_token', client_secret: 'th-secret', access_token: 'short-th' } });
    expect(ax.get.mock.calls.some(([u]) => String(u).includes('graph.facebook.com'))).toBe(false);
  });

  it('refreshes Threads tokens with th_refresh_token', async () => {
    const { encryptToken } = await import('../src/auth/crypto');
    prisma.socialAccount.findMany.mockResolvedValue([{ id: 'a1', provider: 'threads', accessToken: encryptToken('old-th'), name: '@bob' }]);
    ax.get.mockResolvedValue({ data: { access_token: 'new-th', expires_in: 5_184_000 } });
    await meta.refreshExpiringTokens();
    expect(ax.get).toHaveBeenCalledWith('https://graph.threads.net/refresh_access_token', { params: { grant_type: 'th_refresh_token', access_token: 'old-th' } });
  });
});
