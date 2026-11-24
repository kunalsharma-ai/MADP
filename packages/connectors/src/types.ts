import type {
  CapabilityFinding,
  ConnectorHealth,
  ConnectorMode,
  PanelCode,
  ChangeQuery,
  SourceAnswer,
  SourceChangePage,
  SourceDeletion,
  SourceOption,
  SourcePage,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
} from '@madp/contracts';

/**
 * One connector per source panel. The three panels share an ancestor codebase but have diverged, so each
 * connector declares its own verified capabilities and endpoint map. Never assume one panel's route works
 * on another.
 */
export interface PanelConnector {
  readonly panel: PanelCode;
  readonly mode: ConnectorMode;
  capabilities(): CapabilityFinding[];
  health(): Promise<ConnectorHealth>;
  listQuestionnaires(): Promise<SourceQuestionnaire[]>;
  listQuestions(): Promise<SourceQuestion[]>;
  listOptions(sourceQuestionId: string): Promise<SourceOption[]>;
  listRespondents(cursor: string | null, limit: number): Promise<SourcePage<SourceRespondent>>;
  /** Answers for a set of members, restricted to the given question ids. */
  listAnswers(sourceMemberIds: string[], sourceQuestionIds: string[]): Promise<SourceAnswer[]>;
  /**
   * Changed-since feeds, for automatic sync. Optional: a connector without them can only be fully re-imported.
   * A live panel that does not serve them yet answers 404, which surfaces as ConnectorError kind 'not_supported'.
   */
  memberChanges?(q: ChangeQuery): Promise<SourceChangePage<SourceRespondent>>;
  answerChanges?(q: ChangeQuery): Promise<SourceChangePage<SourceAnswer>>;
  deletions?(q: ChangeQuery): Promise<SourceChangePage<SourceDeletion>>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly panel: PanelCode,
    readonly kind: 'not_authorised' | 'not_supported' | 'source_error' | 'invalid_payload' | 'timeout',
    /** HTTP status of the source answer, when there was one. */
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
