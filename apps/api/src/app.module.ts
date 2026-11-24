import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { ApiEnv } from '@madp/config';
import { API_ENV } from './common/tokens.js';
import { Database } from './db/database.js';
import { Mongo } from './mongo/mongo.js';
import { FieldCrypto } from './crypto/field-crypto.js';
import { AuditService } from './audit/audit.service.js';
import { AuditController } from './audit/audit.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { ConnectorRegistry } from './connectors/connector-registry.js';
import { ConnectorsController } from './connectors/connectors.controller.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { SyncScheduler } from './ingestion/sync-scheduler.js';
import { AudienceService } from './audience/audience.service.js';
import { AudienceController } from './audience/audience.controller.js';
import { RegistryController } from './registry/registry.controller.js';
import { PanellistsController } from './panellists/panellists.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { IdentityController } from './identity/identity.controller.js';
import { KeyRotationService } from './crypto/key-rotation.service.js';
import { WebhookService } from './webhooks/webhook.service.js';
import { WebhookController } from './webhooks/webhook.controller.js';
import { HealthController } from './common/health.controller.js';
import { MetaController } from './common/meta.controller.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }])],
      controllers: [
        HealthController,
        MetaController,
        AuthController,
        AudienceController,
        ConnectorsController,
        RegistryController,
        PanellistsController,
        DashboardController,
        AuditController,
        IdentityController,
        WebhookController,
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        Database,
        Mongo,
        FieldCrypto,
        AuditService,
        AuthService,
        ConnectorRegistry,
        IngestionService,
        SyncScheduler,
        AudienceService,
        IdentityService,
        KeyRotationService,
        WebhookService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AuthService, IngestionService, Database, Mongo],
    };
  }
}
