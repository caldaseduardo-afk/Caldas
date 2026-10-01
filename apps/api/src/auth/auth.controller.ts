import { IdentityOnly } from '../permissions/permission.decorator';
import { TenantOptional } from '../tenancy/tenant.guard';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { serialize } from 'cookie';
import { AuthService } from './auth.service';
import { AuthConfig } from './auth.config';
import { loginInput } from './auth.input';
import { Public, readToken, type AuthRequest } from './auth.guard';

@IdentityOnly()
@TenantOptional()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfig,
  ) {}
  private cookie(value: string, maxAge: number) {
    return serialize(this.config.cookieName, value, {
      httpOnly: true,
      secure: this.config.secure,
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
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      throw new UnsupportedMediaTypeException();
    const input = loginInput(body);
    const result = await this.auth.login(
      input.email,
      input.password,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
      readToken(request, this.config),
    );
    response.setHeader(
      'Set-Cookie',
      this.cookie(result.token, this.config.sessionMs / 1000),
    );
    return result.user;
  }
  @Get('me')
  me(@Req() request: AuthRequest) {
    return request.identity;
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(request.sessionToken!, request.identity!.id);
    response.setHeader('Set-Cookie', this.cookie('', 0));
  }
}
