// Must be the first import: loads apps/api/.env into process.env
import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
