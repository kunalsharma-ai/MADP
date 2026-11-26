import type {
  ChangeQuery,
  ConnectorHealth,
  PanelCode,
  SourceAnswer,
  SourceChangePage,
  SourceDeletion,
  SourcePage,
  SourceRespondent,
} from '@madp/contracts';
import type { PanelConnector } from '@madp/connectors';
import type { InboxService } from './inbox.service.js';

/**
 * Connector of a network on other software. Reads the network's inbox (uploads and pushes) instead of calling an
 * API, so the sync treats it like any other panel. Only built once live sync is approved for the panel.
 */
export class InboxConnector implements PanelConnector {
  readonly mode = 'live' as const;

  constructor(
    readonly panel: PanelCode,
    private readonly inbox: InboxService,
  ) {}

  capabilities() {
    return [];
  }

  async health(): Promise<ConnectorHealth> {
    const t = Date.now();
    const c = await this.inbox.counts(this.panel);
    return {
      panel: this.panel,
      mode: 'live',
      state: 'healthy',
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - t,
      message: `Network inbox: ${c.members} member, ${c.answers} answer, ${c.questions} question and ${c.deletions} deletion records received.`,
    };
  }

  async listQuestionnaires() {
    return [];
  }

  async listQuestions() {
    return (await this.inbox.questions(this.panel)).map(({ options: _o, ...q }) => q);
  }

  async listOptions(sourceQuestionId: string) {
    return (await this.inbox.questions(this.panel)).find((q) => q.sourceQuestionId === sourceQuestionId)?.options ?? [];
  }

  async listRespondents(cursor: string | null, limit: number): Promise<SourcePage<SourceRespondent>> {
    const p = await this.inbox.page<SourceRespondent>(this.panel, 'member', cursor, limit);
    return { items: p.items, nextCursor: p.more ? p.cursor : null };
  }

  listAnswers(sourceMemberIds: string[], sourceQuestionIds: string[]): Promise<SourceAnswer[]> {
    return this.inbox.answers(this.panel, sourceMemberIds, sourceQuestionIds);
  }

  memberChanges(q: ChangeQuery): Promise<SourceChangePage<SourceRespondent>> {
    return this.inbox.page<SourceRespondent>(this.panel, 'member', q.cursor, q.limit);
  }

  answerChanges(q: ChangeQuery): Promise<SourceChangePage<SourceAnswer>> {
    return this.inbox.page<SourceAnswer>(this.panel, 'answer', q.cursor, q.limit);
  }

  deletions(q: ChangeQuery): Promise<SourceChangePage<SourceDeletion>> {
    return this.inbox.page<SourceDeletion>(this.panel, 'deletion', q.cursor, q.limit);
  }
}
