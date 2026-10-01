import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AuthConfig } from './auth/auth.config';

export function configureApplication(
  app: NestExpressApplication,
  config: AuthConfig,
) {
  app.useBodyParser('json', { limit: '8kb' });
  app.enableCors({
    origin: config.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (config.secure)
      response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.enableShutdownHooks();
}

export async function createApplication() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  configureApplication(app, app.get(AuthConfig));
  return app;
}
