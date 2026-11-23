import type {
  CapabilityFinding,
  ConnectorHealth,
  ConnectorMode,
  PanelCode,
  SourceAnswer,
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
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly panel: PanelCode,
    readonly kind: 'not_authorised' | 'not_supported' | 'source_error' | 'invalid_payload' | 'timeout',
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}
