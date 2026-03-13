export interface ExtensionSettings {
  backendBaseUrl: string;
  backendBaseUrlFallbacks: string[];
  overlayMinimized: boolean;
  overlayPosX: number;
  overlayPosY: number;
  refreshTimeoutMs: number;
  workflowMode: 'interactive' | 'fast';
}

export interface CapturedNetworkEntry {
  transport: 'fetch' | 'xhr';
  endpoint: string;
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  requestBody: string;
  responseBody: string;
  durationMs: number;
  capturedAt: string;
  extractedReviewActionId?: string;
  extractedFrom?: string;
  autoFetch?: boolean;
  manualTrigger?: boolean;
  triggeredByEndpoint?: string;
  triggeredByUrl?: string;
}

export interface ReviewAnnotation {
  id: string;
  reviewActionId: string;
  type: string;
  content: string;
  processedRecordingId: string;
  startTimeInSeconds: number;
  endTimeInSeconds: number;
  metadata: Record<string, unknown> | null;
}

export interface ReviewRecording {
  id: string;
  transcriptionChunkId: string;
  processedRecordingId: string;
  speaker: number;
  startTimeInSeconds: number;
  endTimeInSeconds: number;
}

export interface ReviewLintError {
  annotationId: string;
  reason: string;
  severity: string;
}

export interface NormalizedReviewAction {
  actionId: string;
  actionLevel: number;
  actionDecision: string;
  annotations: ReviewAnnotation[];
  recordings: ReviewRecording[];
  lintErrors: ReviewLintError[];
  capturedAt: string;
}

export interface StoredSession {
  reviewActionId: string;
  original: NormalizedReviewAction;
  current: NormalizedReviewAction;
  originalCapturedAt: string;
  currentCapturedAt: string;
}

export interface StoredState {
  sessions: Record<string, StoredSession>;
  settings: ExtensionSettings;
  selectedSessionId: string;
}

export interface DiffCommandPayload {
  reviewActionId: string;
  transcriptionChunkId: string;
}

export interface BabelDiffPayload {
  ok: boolean;
  currentReviewActionId: string;
  referenceReviewActionId?: string;
  transcriptionChunkId: string;
  reviewActionsUrl?: string;
  diffUrl?: string;
  reviewActionsPayload?: unknown;
  diffPayload?: unknown;
  error?: string;
  capturedAt: string;
}

export interface FeedbackItem {
  category: string;
  note: string;
  score?: number;
}

export type ReviewEvidence =
  | {
      kind: 'text-diff';
      before: string;
      after: string;
      inlineDiff?: string;
    }
  | {
      kind: 'raw';
      text: string;
    };

export interface BackendVersionInfo {
  service: string;
  release: string;
  apiSchema: number;
  evidenceSchema: number;
}

export interface GeneratedReviewResponse {
  llm?: {
    feedback?: FeedbackItem[];
    classifications?: Array<{
      change: number;
      templateId: string;
    }>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface InputSnapshot {
  categories: Record<string, { note: string }>;
  notes: Array<{ index: number; note: string }>;
}

export interface ReviewKernel {
  start(): Promise<void>;
  ensureMagicButton(): void;
}

export interface MagicButtonController {
  ensure(onClick: () => void | Promise<void>): void;
  setState(mode: 'idle' | 'loading' | 'done' | 'error', label?: string): void;
  pushToast(message: string, isError: boolean): void;
  applyFeedback(feedback: FeedbackItem[]): Promise<{ applied: number }>;
  collectInputBoxesSnapshot(): InputSnapshot;
}

export interface ReviewSessionCard {
  id?: string;
  changeIndex: number;
  type: string;
  description?: string;
  summary?: string;
  /** Compact evidence: the exact diff/summary the LLM classified */
  evidence?: string | null;
  evidenceDetail?: ReviewEvidence | null;
  categories: string[];
  matchedTemplateId?: string | null;
  templateTitle?: string | null;
  templateDescription?: string | null;
  opinionText?: string | null;
  rationale?: string | null;
}

export interface ReviewSessionComments {
  sessionComment: string;
  cardComments: Record<string, string>;
}

export interface ReviewSessionSuggestion {
  proposalId: string;
  operation: 'create_template' | 'update_template' | 'disable_template';
  category: string;
  targetTemplateId?: string | null;
  title?: string | null;
  description?: string | null;
  reportTexts?: string[];
  reason: string;
  sourceCardIds: string[];
  decision?: 'pending' | 'approved' | 'rejected' | null;
}

export interface ReviewSessionData {
  sessionId: string;
  reviewActionId: string;
  backendVersion?: BackendVersionInfo | null;
  prepared?: Record<string, unknown> | null;
  cards: ReviewSessionCard[];
  categoryFeedback: FeedbackItem[];
  comments: ReviewSessionComments;
  suggestions: ReviewSessionSuggestion[];
  aiReview?: GeneratedReviewResponse['llm'] | null;
  [key: string]: unknown;
}

export interface ReviewSessionCreateResponse extends ReviewSessionData {}

export interface ReviewSessionFinalizeResponse {
  sessionId: string;
  reviewActionId: string;
  backendVersion?: BackendVersionInfo | null;
  categoryFeedback: FeedbackItem[];
  aiReview?: GeneratedReviewResponse['llm'] | null;
  [key: string]: unknown;
}

export interface ReviewSessionApplyCommand {
  commandId: string;
  sessionId: string;
  reviewActionId: string;
  clientId: string;
  createdAt: string;
  feedback: FeedbackItem[];
  aiReview?: GeneratedReviewResponse['llm'] | null;
}

declare global {
  interface Window {
    __babelReviewKernelInstalled?: boolean;
    __babelReviewPageBridgeInstalled?: boolean;
  }
}
