// Must be the first import: loads apps/api/.env into process.env
import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // JSON bodies up to 3 MB: a CSV import sends the file text (step 4.3,
  // at most 2000 lines). The default limit is 100 KB.
  app.useBodyParser('json', { limit: '3mb' });

  // Every route lives under /api  ->  /api/health, /api/clients, ...
  app.setGlobalPrefix('api');

  // Close the database pool cleanly when the server stops (Ctrl + C).
  app.enableShutdownHooks();

  // HOST comes from .env. Development value: 127.0.0.1 (this computer only).
  await app.listen(env.PORT, env.HOST);
  Logger.log(
    `ALAA AD MANAGER API running on http://${env.HOST}:${env.PORT}/api (${env.NODE_ENV})`,
    'Bootstrap',
  );
}

void bootstrap();
