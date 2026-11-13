import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Development only: 127.0.0.1 means the API is reachable from this computer only,
// not from other devices on the network. Will become configurable in step 0.4.
const HOST = '127.0.0.1';
const PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Every route lives under /api  ->  /api/health, /api/clients, ...
  app.setGlobalPrefix('api');

  // Close connections cleanly when the server stops (Ctrl + C).
  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
  Logger.log(`ALAA AD MANAGER API running on http://${HOST}:${PORT}/api`, 'Bootstrap');
}

void bootstrap();
