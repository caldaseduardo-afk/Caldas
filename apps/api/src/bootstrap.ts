import 'reflect-metadata';
import { raw } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AuthConfig } from './auth/auth.config';

export function configureApplication(
  app: NestExpressApplication,
  config: AuthConfig,
) {
  app.use(
    '/webhooks/whatsapp',
    raw({ type: 'application/json', limit: '256kb', inflate: false }),
  );
  app.useBodyParser('json', { limit: '8kb' });
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        ['entity.too.large', 'entity.parse.failed'].includes(String(error.type))
      ) {
        response
          .status(error.type === 'entity.too.large' ? 413 : 400)
          .json({ message: 'Payload inválido.' });
        return;
      }
      next(error);
    },
  );
  app.enableCors({
    origin: config.origin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
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
