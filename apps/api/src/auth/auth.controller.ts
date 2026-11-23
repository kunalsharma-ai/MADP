import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { LoginRequest } from '@madp/contracts';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AllowMfaSetupScope, CurrentPrincipal, Public } from './decorators.js';
import type { Principal } from './auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginRequest)) body: LoginRequest, @Req() req: Request) {
    return this.auth.login(body, req.ip ?? null);
  }

  @AllowMfaSetupScope()
  @Get('me')
  me(@CurrentPrincipal() p: Principal) {
    return this.auth.me(p);
  }

  @AllowMfaSetupScope()
  @Post('mfa/setup')
  @HttpCode(200)
  beginMfa(@CurrentPrincipal() p: Principal) {
    return this.auth.beginMfa(p);
  }

  @AllowMfaSetupScope()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('mfa/confirm')
  @HttpCode(200)
  confirmMfa(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(z.object({ code: z.string().regex(/^\d{6}$/) }))) body: { code: string },
    @Req() req: Request,
  ) {
    return this.auth.confirmMfa(p, body.code, req.ip ?? null);
  }
}
