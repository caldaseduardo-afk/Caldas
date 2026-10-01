import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function createApplication() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  return app;
}
