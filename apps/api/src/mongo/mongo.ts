import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MongoClient, type Collection, type Db } from 'mongodb';
import type { ApiEnv } from '@madp/config';
import type { DataMode, PanelCode } from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';

/** Immutable reference to everything received from a source (no raw PII for respondent events). */
export interface SourceEventDoc {
  panel: PanelCode;
  dataMode: DataMode;
  kind: 'questionnaire' | 'question' | 'option_set' | 'respondent' | 'answer';
  sourceKey: string;
  contentHash: string;
  payload: unknown;
  importJobId: string;
  receivedAt: Date;
}

export interface QuestionVersionDoc {
  panel: PanelCode;
  dataMode: DataMode;
  sourceQuestionId: string;
  version: number;
  contentHash: string;
  label: string;
  type: string | null;
  parent: string | null;
  sourceCategories: string[];
  options: { value: string; label: string; parentValues: string[]; isExclusive: boolean }[];
  /** Questionnaire slugs that include this question in the latest import. */
  questionnaires: string[];
  sensitivity: 'standard' | 'special_category';
  firstSeenAt: Date;
  importJobId: string;
}

export interface ProfileAnswerDoc {
  personId: string;
  panel: PanelCode;
  dataMode: DataMode;
  sourceMemberId: string;
  sourceQuestionId: string;
  questionVersion: number;
  values: string[];
  sensitivity: 'standard' | 'special_category';
  sourceUpdatedAt: Date | null;
  ingestedAt: Date;
  importJobId: string;
}

export interface AnswerHistoryDoc extends ProfileAnswerDoc {
  supersededAt: Date;
}

@Injectable()
export class Mongo implements OnModuleInit, OnModuleDestroy {
  readonly client: MongoClient;
  readonly db: Db;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.client = new MongoClient(env.MONGODB_URL, { serverSelectionTimeoutMS: 5000 });
    this.db = this.client.db(env.MONGODB_DB);
  }

  get sourceEvents(): Collection<SourceEventDoc> {
    return this.db.collection('source_events');
  }
  get questionVersions(): Collection<QuestionVersionDoc> {
    return this.db.collection('question_versions');
  }
  get profileAnswers(): Collection<ProfileAnswerDoc> {
    return this.db.collection('profile_answers');
  }
  get answerHistory(): Collection<AnswerHistoryDoc> {
    return this.db.collection('answer_history');
  }

  async onModuleInit() {
    await this.client.connect();
    await this.ensureIndexes();
  }

  async ensureIndexes() {
    await this.sourceEvents.createIndex(
      { panel: 1, dataMode: 1, kind: 1, sourceKey: 1, contentHash: 1 },
      { unique: true },
    );
    await this.questionVersions.createIndex(
      { panel: 1, dataMode: 1, sourceQuestionId: 1, version: 1 },
      { unique: true },
    );
    await this.profileAnswers.createIndex(
      { panel: 1, dataMode: 1, sourceMemberId: 1, sourceQuestionId: 1 },
      { unique: true },
    );
    await this.profileAnswers.createIndex({ personId: 1 });
    await this.answerHistory.createIndex({ personId: 1, sourceQuestionId: 1 });
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
