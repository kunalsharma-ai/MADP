import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PanelCode } from '@madp/contracts';
import { PanelAdminClient, PanelAdminError } from '@madp/connectors';
import { CAPABILITIES, matchOperation } from '@madp/panel-contract';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { Database } from '../db/database.js';
import { brandSettings } from '../db/schema.js';

/**
 * Calls the shared panel backend's signed admin API for one brand. The brand's hostname is the first origin in its
 * brand settings, so the panel filters every query on that brand. Panel errors become the matching HTTP errors.
 */
@Injectable()
export class PanelAdminService {
  constructor(
    private readonly database: Database,
    private readonly registry: ConnectorRegistry,
  ) {}

  /** Whether the brand's admin API is configured (secret and base URL), on Panel connections or in env. */
  configured(panel: PanelCode): boolean {
    return this.registry.adminConfig(panel) !== null;
  }

  async client(panel: PanelCode): Promise<PanelAdminClient> {
    const cfg = this.registry.adminConfig(panel);
    if (!cfg)
      throw new ServiceUnavailableException({
        code: 'panel_admin_not_configured',
        message: `The ${panel.toUpperCase()} panel admin API is not connected yet. Set its address and admin secret on Panel connections.`,
      });
    const { baseUrl, secret } = cfg;
    const row = await this.database.db.query.brandSettings.findFirst({
      where: eq(brandSettings.panel, panel),
    });
    const origin = row?.origins[0];
    if (!origin) throw new ServiceUnavailableException(`No hostname set for ${panel} in Brands & settings`);
    return new PanelAdminClient(panel, { baseUrl, origin, secret });
  }

  async call<T>(
    panel: PanelCode,
    actor: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    this.requireCapability(panel, method, path);
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

  /**
   * Every call goes through the MADP Panel API Contract: the route must be a contract route, and the panel must offer
   * its capability. A panel that did not declare it answers 501 `capability_not_supported`, before anything is sent.
   */
  requireCapability(panel: PanelCode, method: string, path: string) {
    const m = matchOperation(method, path);
    if (!m)
      throw new InternalServerErrorException({
        code: 'route_not_in_contract',
        message: `${method} ${path.split('?')[0]} is not a route of the panel API contract`,
      });
    const contract = this.registry.contract(panel);
    if (!contract.capabilities.includes(m.op.capability))
      throw new NotImplementedException({
        code: 'capability_not_supported',
        capability: m.op.capability,
        message: `${panel.toUpperCase()} does not offer "${CAPABILITIES[m.op.capability].title}" in its panel API contract`,
      });
    return m.op;
  }

  /** Whether the panel offers a capability (for screens that hide what a panel can't do). */
  offers(panel: PanelCode, capability: keyof typeof CAPABILITIES): boolean {
    return this.registry.contract(panel).capabilities.includes(capability);
  }

  static forbidden(): never {
    throw new ForbiddenException('Not permitted on this brand');
  }

  static reasonRequired(): never {
    throw new BadRequestException({ code: 'reason_required', message: 'A reason is required' });
  }
}
