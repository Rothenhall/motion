// Test-only configuration; never used outside jest.
process.env.DATABASE_URL = 'file:./test.db';
process.env.AUTH_SECRET = 'test-auth-secret-that-is-at-least-32-characters';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_IG_APP_SECRET = 'test-ig-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
