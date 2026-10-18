import { Public } from './auth/auth.guard';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from './auth/database.service';
import { RateLimitService } from './rate-limit/rate-limit.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    let database = 'up';
    try {
      await this.database.client.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const rateLimit = (await this.rateLimit.isAvailable()) ? 'up' : 'down';
    if (database === 'down' || rateLimit === 'down') response.status(503);
    return {
      status: database === 'up' && rateLimit === 'up' ? 'ready' : 'not_ready',
      dependencies: { database, rateLimit },
    };
  }
}
