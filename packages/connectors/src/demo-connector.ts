import type {
  ChangeQuery,
  ConnectorHealth,
  PanelCode,
  SourceAnswer,
  SourceChangePage,
  SourceDeletion,
  SourcePage,
  SourceRespondent,
  SourceResponse,
  SourceReward,
} from '@madp/contracts';
import { generateDemoLoyalty, generateDemoPopulation, loadSourceSample, type DemoPopulation } from '@madp/testing';
import { AUDITED_CAPABILITIES } from './capabilities.js';
import { mapOption, mapQuestion, mapQuestionnaire } from './mapping.js';
import type { PanelConnector } from './types.js';

/**
 * DEMO connector: questionnaire definitions come from the committed source samples (real question
 * definitions for T2O and MHO, synthetic placeholders for MFR); respondents and answers are synthetic.
 * Everything it returns must be stored with data_mode = 'demo'.
 */
export class DemoConnector implements PanelConnector {
  readonly mode = 'demo' as const;
  private static population: DemoPopulation | null = null;
  private static populationSize = 0;
  private static loyalty: ReturnType<typeof generateDemoLoyalty> | null = null;
  /** Tests can replace or extend the DEMO wallet rows (for example, to reverse a credit). */
  rewardsOverride: SourceReward[] | null = null;
  responsesOverride: SourceResponse[] | null = null;
  /** Tests only: deletions the panel reports. DEMO panels delete nobody by default. */
  deletionsOverride: SourceDeletion[] | null = null;

  constructor(
    readonly panel: PanelCode,
    private readonly people = 1500,
  ) {}

  private get pop(): DemoPopulation {
    if (!DemoConnector.population || DemoConnector.populationSize !== this.people) {
      DemoConnector.population = generateDemoPopulation({ people: this.people });
      DemoConnector.populationSize = this.people;
      DemoConnector.loyalty = null;
    }
    return DemoConnector.population;
  }

  private get wallet() {
    const pop = this.pop;
    DemoConnector.loyalty ??= generateDemoLoyalty(pop);
    return DemoConnector.loyalty;
  }

  capabilities() {
    return AUDITED_CAPABILITIES[this.panel];
  }

  async health(): Promise<ConnectorHealth> {
    return {
      panel: this.panel,
      mode: 'demo',
      state: 'healthy',
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      message: 'DEMO fixtures. No source system is contacted.',
    };
  }

  async listQuestionnaires() {
    return loadSourceSample(this.panel).profiles.map((p) =>
      mapQuestionnaire(this.panel, { ...p, category: p.sourceCategory }),
    );
  }

  async listQuestions() {
    return loadSourceSample(this.panel).questions.map((q) =>
      mapQuestion(this.panel, {
        ...q,
        ...(q.type ? { type: q.type } : {}),
        category: ([] as string[]).concat(q.category),
      }),
    );
  }

  async listOptions(sourceQuestionId: string) {
    return loadSourceSample(this.panel)
      .options.filter((o) => o.question === sourceQuestionId)
      .map((o) => mapOption(this.panel, o));
  }

  async listRespondents(cursor: string | null, limit: number): Promise<SourcePage<SourceRespondent>> {
    const all = this.pop.respondents.filter((r) => r.panel === this.panel);
    const start = cursor ? Number.parseInt(cursor, 10) : 0;
    const items = all.slice(start, start + limit);
    const next = start + items.length;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }

  async listAnswers(sourceMemberIds: string[], sourceQuestionIds: string[]): Promise<SourceAnswer[]> {
    const ids = new Set(sourceMemberIds);
    const qs = new Set(sourceQuestionIds);
    return this.pop.answers.filter(
      (a) => a.panel === this.panel && ids.has(a.sourceMemberId) && qs.has(a.sourceQuestionId),
    );
  }

  /** DEMO changes feeds: the fixed population in a stable order; the cursor is a position in it. */
  private feedPage<T extends { sourceUpdatedAt: string | null }>(
    all: T[],
    q: ChangeQuery,
  ): SourceChangePage<T> {
    const since = !q.cursor && q.since ? Date.parse(q.since) : null;
    const list =
      since === null ? all : all.filter((x) => x.sourceUpdatedAt && Date.parse(x.sourceUpdatedAt) >= since);
    const start = q.cursor ? Number.parseInt(q.cursor, 10) : 0;
    const items = list.slice(start, start + q.limit);
    const next = start + items.length;
    return { items, cursor: String(next), more: next < list.length };
  }

  async memberChanges(q: ChangeQuery) {
    return this.feedPage(
      this.pop.respondents.filter((r) => r.panel === this.panel),
      q,
    );
  }

  async answerChanges(q: ChangeQuery) {
    return this.feedPage(
      this.pop.answers.filter((a) => a.panel === this.panel),
      q,
    );
  }

  async deletions(q: ChangeQuery): Promise<SourceChangePage<SourceDeletion>> {
    if (!this.deletionsOverride) return { items: [], cursor: q.cursor, more: false };
    const start = q.cursor ? Number.parseInt(q.cursor, 10) : 0;
    const items = this.deletionsOverride.slice(start, start + q.limit);
    return { items, cursor: String(start + items.length), more: start + items.length < this.deletionsOverride.length };
  }

  async rewardChanges(q: ChangeQuery): Promise<SourceChangePage<SourceReward>> {
    return this.feedPage(this.rewardsOverride ?? this.wallet.rewards.filter((x) => x.panel === this.panel), q);
  }

  async responseChanges(q: ChangeQuery): Promise<SourceChangePage<SourceResponse>> {
    return this.feedPage(this.responsesOverride ?? this.wallet.responses.filter((x) => x.panel === this.panel), q);
  }
}
