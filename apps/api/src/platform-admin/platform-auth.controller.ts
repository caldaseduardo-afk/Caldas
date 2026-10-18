import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { serialize } from 'cookie';
import { z } from 'zod';
import { Public, type AuthRequest } from '../auth/auth.guard';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformOnly } from './platform.decorator';
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});
const login = credentials
  .extend({ code: z.string().regex(/^\d{6}$/) })
  .strict();
const enrollment = credentials
  .extend({
    invite: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict();
@Controller('super-admin')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}
  private cookie(value: string, maxAge: number) {
    return serialize(this.auth.cookieName, value, {
      httpOnly: true,
      secure: this.auth.config.secure,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = login.safeParse(body);
    if (!input.success) throw new BadRequestException('Credenciais inválidas.');
    const token = await this.auth.login(
      input.data.email,
      input.data.password,
      input.data.code,
      req.ip ?? 'unknown',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', this.cookie(token, 3600));
    return { authenticated: true };
  }
  @Public()
  @Post('enroll')
  @HttpCode(200)
  async enroll(
    @Body() body: unknown,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = enrollment.safeParse(body);
    if (!input.success) throw new BadRequestException('Convite inválido.');
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.enroll(
      input.data.email,
      input.data.password,
      input.data.invite,
      req.ip ?? 'unknown',
      input.data.code,
    );
  }
  @PlatformOnly()
  @Get('session')
  session(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return { role: 'SUPER_ADMIN' };
  }
  @PlatformOnly()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.platform!);
    res.setHeader('Set-Cookie', this.cookie('', 0));
  }
}
