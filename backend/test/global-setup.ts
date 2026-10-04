import { execSync } from 'child_process';
import { rmSync } from 'fs';
import { join } from 'path';

/** Builds a fresh SQLite database from the committed migrations for each run. */
export default function globalSetup() {
  for (const f of ['test.db', 'test.db-journal']) rmSync(join(__dirname, '..', 'prisma', f), { force: true });
  execSync('npx prisma migrate deploy', { cwd: join(__dirname, '..'), env: { ...process.env, DATABASE_URL: 'file:./test.db' }, stdio: 'ignore' });
}
