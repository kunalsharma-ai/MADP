import type { ConnectorHealth, PanelCode, SourceAnswer, SourcePage, SourceRespondent } from '@madp/contracts';
import { generateDemoPopulation, loadSourceSample, type DemoPopulation } from '@madp/testing';
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

  constructor(
    readonly panel: PanelCode,
    private readonly people = 1500,
  ) {}

  private get pop(): DemoPopulation {
    if (!DemoConnector.population || DemoConnector.populationSize !== this.people) {
      DemoConnector.population = generateDemoPopulation({ people: this.people });
      DemoConnector.populationSize = this.people;
    }
    return DemoConnector.population;
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
    return loadSourceSample(this.panel).profiles.map((p) => mapQuestionnaire(this.panel, { ...p, category: p.sourceCategory }));
  }

  async listQuestions() {
    return loadSourceSample(this.panel).questions.map((q) =>
      mapQuestion(this.panel, { ...q, ...(q.type ? { type: q.type } : {}), category: ([] as string[]).concat(q.category) }),
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
    return this.pop.answers.filter((a) => a.panel === this.panel && ids.has(a.sourceMemberId) && qs.has(a.sourceQuestionId));
  }
}
