import { execSync } from 'child_process';
import { join } from 'path';
import './env';

/** Resets the test database to the committed migrations for each run. */
export default function globalSetup() {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: join(__dirname, '..'), env: process.env, stdio: 'ignore' });
}
