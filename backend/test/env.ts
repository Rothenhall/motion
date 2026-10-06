// Test-only configuration; never used outside jest.
// Postgres from `docker compose up -d db`; override with TEST_DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://motion:motion@localhost:5432/motion_test?schema=public';
process.env.AUTH_SECRET = 'test-auth-secret-that-is-at-least-32-characters';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_IG_APP_SECRET = 'test-ig-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
process.env.RATE_LIMIT = 'off';
