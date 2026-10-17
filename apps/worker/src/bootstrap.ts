import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function createApplication() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  // main.ts coordena sinais para aguardar a expiração antes de desconectar.
  return app;
}
