import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { assertSecurityConfig } from './auth/crypto';
import { configureApp } from './configure-app';

async function bootstrap() {
  assertSecurityConfig();
  // rawBody: Meta webhook signatures are computed over the exact request bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  app.enableCors({ origin: process.env.FRONTEND_URL?.split(',') ?? true });
  // Uploaded media must be publicly reachable so Meta can fetch it at publish time.
  const uploads = join(process.cwd(), 'uploads');
  if (!existsSync(uploads)) mkdirSync(uploads, { recursive: true });
  app.useStaticAssets(uploads, { prefix: '/media/' });
  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Motion backend on http://localhost:${port}`);
}
bootstrap();
