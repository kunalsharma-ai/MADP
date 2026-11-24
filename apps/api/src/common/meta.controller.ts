import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { Public } from '../auth/decorators.js';
import { API_ENV } from './tokens.js';
import { openApiDocument } from './openapi.js';

@Controller()
export class MetaController {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Public outside production. In production the route map is hidden from scanners unless OPENAPI_PUBLIC=true. */
  @Public()
  @Get('openapi.json')
  openapi() {
    const open = this.env.OPENAPI_PUBLIC ?? this.env.NODE_ENV !== 'production';
    if (!open) throw new NotFoundException();
    return openApiDocument();
  }
}
