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
import { PanelDirectory } from './panels/panel-directory.js';
import { PanelsController } from './panels/panels.controller.js';
import { SegmentDirectory } from './segments/segment-directory.js';
import { InboxService } from './networks/inbox.service.js';
import { NetworksController } from './networks/networks.controller.js';
import { AudienceSegmentsController } from './segments/segments.controller.js';
import { PanelConnectionsController } from './connectors/panel-connections.controller.js';
import { ConnectorsController } from './connectors/connectors.controller.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { SyncScheduler } from './ingestion/sync-scheduler.js';
import { AudienceService } from './audience/audience.service.js';
import { AudienceController } from './audience/audience.controller.js';
import { RegistryController } from './registry/registry.controller.js';
import { PanellistsController } from './panellists/panellists.controller.js';
import { NewMembersController } from './new-members/new-members.controller.js';
import { FraudAlertsController } from './new-members/fraud-alerts.controller.js';
import { MemberViewsController } from './new-members/member-views.controller.js';
import { ActivityController } from './new-members/activity.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { IdentityController } from './identity/identity.controller.js';
import { KeyRotationService } from './crypto/key-rotation.service.js';
import { WebhookService } from './webhooks/webhook.service.js';
import { WebhookController } from './webhooks/webhook.controller.js';
import { EngagementService } from './engagement/engagement.service.js';
import { EngagementController } from './engagement/engagement.controller.js';
import { AutomationService } from './engagement/automation.service.js';
import { AutomationController } from './engagement/automation.controller.js';
import { LoyaltyService } from './loyalty/loyalty.service.js';
import { LoyaltyController } from './loyalty/loyalty.controller.js';
import { ParticipationController } from './loyalty/participation.controller.js';
import { ParticipationService } from './loyalty/participation.service.js';
import { Supply360Service } from './supply360/supply360.service.js';
import { ConsentService } from './consent/consent.service.js';
import { ConsentController } from './consent/consent.controller.js';
import { PrivacyService } from './privacy/privacy.service.js';
import { PrivacyController } from './privacy/privacy.controller.js';
import { FreshnessService } from './profiles/freshness.service.js';
import { FreshnessController } from './profiles/freshness.controller.js';
import { VerificationService } from './verification/verification.service.js';
import { VerificationController } from './verification/verification.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { InsightsService } from './insights/insights.service.js';
import { InsightsController } from './insights/insights.controller.js';
import { MailersService } from './mailers/mailers.service.js';
import { MailersController } from './mailers/mailers.controller.js';
import { ServiceAuthGuard } from './supply360/service-auth.guard.js';
import { ServiceClientsController, Supply360Controller } from './supply360/supply360.controller.js';
import { AdminsController } from './admins/admins.controller.js';
import { AdminsService } from './admins/admins.service.js';
import { BrandsController } from './brands/brands.controller.js';
import { AbuseService } from './common/abuse.service.js';
import { PanelAdminService } from './panel-admin/panel-admin.service.js';
import { MembersController } from './panel-admin/members.controller.js';
import { MemberTypes } from './panel-admin/member-types.js';
import { MemberTagStore } from './panel-admin/member-tags.js';
import { MemberBulkController } from './panel-admin/member-bulk.controller.js';
import { MemberNotesController, MemberTagsController } from './panel-admin/member-notes.controller.js';
import { DuplicatesController } from './panel-admin/duplicates.controller.js';
import { QuestionBankController } from './panel-admin/question-bank.controller.js';
import { QuestionnaireController } from './panel-admin/questionnaire.controller.js';
import { QuestionnaireService } from './panel-admin/questionnaire.service.js';
import {
  PointsQualityController,
  SegmentsController,
  SurveysController,
} from './panel-admin/engagement-admin.controller.js';
import { SupportAdminController } from './panel-admin/support-admin.controller.js';
import { ContentAdminController } from './panel-admin/content-admin.controller.js';
import { RewardsAdminController } from './panel-admin/rewards-admin.controller.js';
import { HealthController } from './common/health.controller.js';
import { MetaController } from './common/meta.controller.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE ?? 300 }])],
      controllers: [
        HealthController,
        MetaController,
        AuthController,
        AudienceController,
        ConnectorsController,
        RegistryController,
        PanellistsController,
        NewMembersController,
        FraudAlertsController,
        MemberViewsController,
        ActivityController,
        DashboardController,
        AuditController,
        AdminsController,
        BrandsController,
        MembersController,
        MemberNotesController,
        MemberTagsController,
        MemberBulkController,
        DuplicatesController,
        QuestionBankController,
        QuestionnaireController,
        SegmentsController,
        SurveysController,
        PointsQualityController,
        SupportAdminController,
        ContentAdminController,
        RewardsAdminController,
        IdentityController,
        WebhookController,
        EngagementController,
        AutomationController,
        LoyaltyController,
        ParticipationController,
        Supply360Controller,
        ServiceClientsController,
        ConsentController,
        PrivacyController,
        FreshnessController,
        VerificationController,
        ReportsController,
        InsightsController,
        MailersController,
        PanelConnectionsController,
        PanelsController,
        AudienceSegmentsController,
        NetworksController,
      ],
      providers: [
        { provide: API_ENV, useValue: env },
        Database,
        PanelDirectory,
        SegmentDirectory,
        InboxService,
        Mongo,
        FieldCrypto,
        AuditService,
        AuthService,
        AdminsService,
        PanelAdminService,
        MemberTypes,
        MemberTagStore,
        AbuseService,
        QuestionnaireService,
        ConnectorRegistry,
        IngestionService,
        SyncScheduler,
        AudienceService,
        IdentityService,
        KeyRotationService,
        WebhookService,
        EngagementService,
        AutomationService,
        LoyaltyService,
        ParticipationService,
        Supply360Service,
        ServiceAuthGuard,
        ConsentService,
        PrivacyService,
        FreshnessService,
        VerificationService,
        ReportsService,
        InsightsService,
        MailersService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [AuthService, IngestionService, Database, Mongo],
    };
  }
}
