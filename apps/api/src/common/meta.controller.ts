import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import { openApiDocument } from './openapi.js';

@Controller()
export class MetaController {
  @Public()
  @Get('openapi.json')
  openapi() {
    return openApiDocument();
  }
}
