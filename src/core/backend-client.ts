import { createJsonClient, normalizeBaseUrl } from '@nominy/babel-extension-frontend';
import type {
  BabelDiffPayload,
  GeneratedReviewResponse,
  InputSnapshot,
  NormalizedReviewAction,
  ReviewSessionCreateResponse,
  ReviewSessionData,
  ReviewSessionFinalizeResponse,
  TemplateSearchResponse
} from './types';

function uniq(values: string[]): string[] {
  const out: string[] = [];
  for (const item of values) {
    if (!out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

function buildBaseCandidates(primary: string, fallbacks: string[]): string[] {
  return uniq([primary, ...fallbacks].map(normalizeBaseUrl).filter(Boolean));
}

interface RequestBase {
  backendBaseUrl: string;
  backendBaseUrlFallbacks: string[];
  reviewActionId: string;
  original: NormalizedReviewAction;
  current: NormalizedReviewAction;
  babelDiff: BabelDiffPayload | null;
}

interface SessionRequestBase {
  backendBaseUrl: string;
  backendBaseUrlFallbacks: string[];
}

function getClient(primary: string, fallbacks: string[]) {
  const baseCandidates = buildBaseCandidates(primary, fallbacks);
  return createJsonClient({
    getBaseCandidates: () => baseCandidates
  });
}

export async function generate(args: RequestBase): Promise<GeneratedReviewResponse> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<GeneratedReviewResponse>('/api/review/generate', {
    reviewActionId: args.reviewActionId,
    original: args.original,
    current: args.current,
    babelDiff: args.babelDiff
  });
}

export async function submitTranscriptReviewActionAnalytics(
  args: RequestBase & {
    inputBoxes: InputSnapshot;
    aiReview: GeneratedReviewResponse['llm'] | null;
    metadata: Record<string, unknown>;
  }
): Promise<unknown> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post('/api/trpc/transcriptions.submitTranscriptReviewAction', {
    reviewActionId: args.reviewActionId,
    original: args.original,
    current: args.current,
    babelDiff: args.babelDiff,
    inputBoxes: args.inputBoxes,
    aiReview: args.aiReview,
    metadata: args.metadata
  });
}

export async function createReviewSession(args: RequestBase): Promise<ReviewSessionCreateResponse> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionCreateResponse>('/api/review/sessions', {
    reviewActionId: args.reviewActionId,
    original: args.original,
    current: args.current,
    babelDiff: args.babelDiff
  });
}

export async function getReviewSession(
  args: SessionRequestBase & {
    sessionId: string;
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).get<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}`
  );
}

export async function searchReviewTemplates(
  args: SessionRequestBase & {
    query: string;
    limit?: number;
  }
): Promise<TemplateSearchResponse> {
  const search = new URLSearchParams();
  search.set('q', args.query);
  if (Number.isFinite(args.limit)) {
    search.set('limit', String(args.limit));
  }
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).get<TemplateSearchResponse>(
    `/api/review/templates/search?${search.toString()}`
  );
}

export async function saveReviewSessionComments(
  args: SessionRequestBase & {
    sessionId: string;
    sessionComment: string;
    cardComments: Record<string, string>;
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/comments`,
    {
      sessionComment: args.sessionComment,
      cardComments: args.cardComments
    }
  );
}

export async function updateReviewSessionCardTemplateMatch(
  args: SessionRequestBase & {
    sessionId: string;
    changeIndex?: number;
    matchedTemplateId?: string;
    cardId?: string;
    templateId?: string;
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/card-template-match`,
    {
      ...(typeof args.changeIndex === 'number' ? { changeIndex: args.changeIndex } : {}),
      ...(args.matchedTemplateId ? { matchedTemplateId: args.matchedTemplateId } : {}),
      ...(args.cardId ? { cardId: args.cardId } : {}),
      ...(args.templateId ? { templateId: args.templateId } : {})
    }
  );
}

export async function clearReviewSessionCardTemplateMatch(
  args: SessionRequestBase & {
    sessionId: string;
    changeIndex?: number;
    cardId?: string;
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/card-template-match/clear`,
    {
      ...(typeof args.changeIndex === 'number' ? { changeIndex: args.changeIndex } : {}),
      ...(args.cardId ? { cardId: args.cardId } : {})
    }
  );
}

export async function finalizeReviewSession(
  args: SessionRequestBase & {
    sessionId: string;
    mode?: 'apply' | 'skip';
  }
): Promise<ReviewSessionFinalizeResponse> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionFinalizeResponse>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/finalize`,
    args.mode ? { mode: args.mode } : {}
  );
}

export async function generateReviewSessionSuggestions(
  args: SessionRequestBase & {
    sessionId: string;
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/suggestions/generate`,
    {}
  );
}

export async function decideReviewSessionSuggestion(
  args: SessionRequestBase & {
    sessionId: string;
    proposalId: string;
    decision: 'approved' | 'rejected';
  }
): Promise<ReviewSessionData> {
  return getClient(args.backendBaseUrl, args.backendBaseUrlFallbacks).post<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/suggestions/${encodeURIComponent(args.proposalId)}/decision`,
    {
      decision: args.decision
    }
  );
}
