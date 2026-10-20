import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { parse, serialize } from 'cookie';
import { z } from 'zod';
import type { AuthRequest } from '../auth/auth.guard';
import { PlatformOnly } from './platform.decorator';
import { PlatformService } from './platform.service';
import { platformQuery, platformTenantId } from './platform.dto';
import { parseSubscriptionChange } from '../plans/plans.dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { PlatformAuthService } from './platform-auth.service';
@PlatformOnly()
@Controller('super-admin')
export class PlatformController {
  constructor(
    private readonly service: PlatformService,
    private readonly auth: PlatformAuthService,
  ) {}
  private tenantAccessCookie(value: string, maxAge: number) {
    return serialize(this.auth.tenantAccessCookieName, value, {
      httpOnly: true,
      secure: this.auth.config.secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  }
  @Post('tenants/:id/access')
  @HttpCode(200)
  @RateLimit(5)
  async startTenantAccess(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = z
      .object({ reason: z.string().trim().min(10).max(500) })
      .strict()
      .safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        'Informe um motivo com ao menos 10 caracteres.',
      );
    const result = await this.auth.startTenantAccess(
      req.platform!,
      platformTenantId(id),
      input.data.reason,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Set-Cookie',
      this.tenantAccessCookie(
        result.token,
        Math.floor((result.expiresAt.getTime() - Date.now()) / 1000),
      ),
    );
    return { tenant: result.tenant, expiresAt: result.expiresAt };
  }
  @Get('tenant-access')
  tenantAccess(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.tenantAccessStatus(req.platform!);
  }
  @Post('tenant-access/end')
  @HttpCode(200)
  async endTenantAccess(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = parse(req.headers.cookie ?? '')[
      this.auth.tenantAccessCookieName
    ];
    const result = await this.auth.endTenantAccess(req.platform!, token);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', this.tenantAccessCookie('', 0));
    return result;
  }
  @Get('overview')
  @RateLimit(60)
  overview(
    @Req() req: AuthRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.read(req.platform!, platformQuery(query));
  }
  @Get('tenants/:id')
  @RateLimit(60)
  tenant(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.read(
      req.platform!,
      platformQuery(query),
      platformTenantId(id),
    );
  }
  @Patch('tenants/:id/subscription')
  changeSubscription(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.changeSubscription(
      req.platform!,
      platformTenantId(id),
      parseSubscriptionChange(body),
    );
  }
  @Get('health')
  health(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.health();
  }
}
