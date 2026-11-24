import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import type { PanelCode } from '@madp/contracts';
import { PanelAdminClient, PanelAdminError } from '@madp/connectors';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { brandSettings } from '../db/schema.js';

const BASE_URL: Record<PanelCode, keyof ApiEnv> = {
  t2o: 'T2O_ADMIN_API_BASE_URL',
  mfr: 'MFR_ADMIN_API_BASE_URL',
  mho: 'MHO_ADMIN_API_BASE_URL',
};

/**
 * Calls the shared panel backend's signed admin API for one brand. The brand's hostname is the first origin in its
 * brand settings, so the panel filters every query on that brand. Panel errors become the matching HTTP errors.
 */
@Injectable()
export class PanelAdminService {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
  ) {}

  /** Whether the brand's admin API is configured (secret and base URL). */
  configured(panel: PanelCode): boolean {
    return Boolean(this.env.PANEL_ADMIN_API_SECRET && this.env[BASE_URL[panel]]);
  }

  async client(panel: PanelCode): Promise<PanelAdminClient> {
    const baseUrl = this.env[BASE_URL[panel]] as string | undefined;
    if (!this.env.PANEL_ADMIN_API_SECRET || !baseUrl)
      throw new ServiceUnavailableException({
        code: 'panel_admin_not_configured',
        message: `The ${panel.toUpperCase()} panel admin API is not connected yet (PANEL_ADMIN_API_SECRET and ${BASE_URL[panel]}).`,
      });
    const row = await this.database.db.query.brandSettings.findFirst({
      where: eq(brandSettings.panel, panel),
    });
    const origin = row?.origins[0];
    if (!origin) throw new ServiceUnavailableException(`No hostname set for ${panel} in Brands & settings`);
    return new PanelAdminClient(panel, { baseUrl, origin, secret: this.env.PANEL_ADMIN_API_SECRET });
  }

  async call<T>(
    panel: PanelCode,
    actor: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    const c = await this.client(panel);
    try {
      return await c.call<T>(actor, method, path, query, body);
    } catch (e) {
      if (!(e instanceof PanelAdminError)) throw e;
      const payload = { code: e.code, message: e.message };
      if (e.httpStatus === 404) throw new NotFoundException(payload);
      if (e.httpStatus === 409) throw new ConflictException(payload);
      if (e.httpStatus === 422) throw new UnprocessableEntityException(payload);
      if (e.httpStatus === 400) throw new BadRequestException(payload);
      // 401/403 from the panel mean MADP's own credential is wrong: an operator problem, not the admin's.
      if (e.httpStatus === 401 || e.httpStatus === 403)
        throw new BadGatewayException({
          code: 'panel_admin_auth',
          message: "The panel refused MADP's credential",
        });
      if (e.httpStatus >= 500 || e.code === 'unreachable') throw new BadGatewayException(payload);
      throw new HttpException(payload, e.httpStatus);
    }
  }

  static forbidden(): never {
    throw new ForbiddenException('Not permitted on this brand');
  }
}
