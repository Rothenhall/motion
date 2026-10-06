import { ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE = 60_000;

/** A roomy ceiling for everything: the app makes many small calls, so this only stops runaway clients. */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: MINUTE, limit: 600 }],
  // RATE_LIMIT=off lets the test suite make thousands of calls from one address; a test turns it back on to check the limits.
  skipIf: () => process.env.RATE_LIMIT === 'off',
};

/** Sign-in and sign-up: tight enough to make guessing a password impractical. Use with @Throttle(). */
export const AUTH_LIMIT = { default: { limit: 10, ttl: MINUTE } };
