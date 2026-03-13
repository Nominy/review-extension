import type {
  BabelDiffPayload,
  GeneratedReviewResponse,
  InputSnapshot,
  NormalizedReviewAction,
  ReviewSessionCreateResponse,
  ReviewSessionData,
  ReviewSessionFinalizeResponse
} from './types';

class HttpStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

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

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errorMessage =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `HTTP ${response.status}: ${text.slice(0, 240)}`;
    throw new HttpStatusError(errorMessage);
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Backend returned non-JSON payload.');
  }

  return data as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseResponse<T>(response);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET'
  });

  return parseResponse<T>(response);
}

async function postJsonWithFallback<T>(path: string, payload: unknown, baseCandidates: string[]): Promise<T> {
  if (!baseCandidates.length) {
    throw new Error('Backend URL is required.');
  }

  const errors: string[] = [];
  for (const base of baseCandidates) {
    try {
      return await postJson<T>(`${base}${path}`, payload);
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof HttpStatusError) {
        throw error;
      }
    }
  }

  throw new Error(`Could not reach backend. Tried: ${errors.join(' | ')}`);
}

async function getJsonWithFallback<T>(path: string, baseCandidates: string[]): Promise<T> {
  if (!baseCandidates.length) {
    throw new Error('Backend URL is required.');
  }

  const errors: string[] = [];
  for (const base of baseCandidates) {
    try {
      return await getJson<T>(`${base}${path}`);
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof HttpStatusError) {
        throw error;
      }
    }
  }

  throw new Error(`Could not reach backend. Tried: ${errors.join(' | ')}`);
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

export async function generate(args: RequestBase): Promise<GeneratedReviewResponse> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<GeneratedReviewResponse>(
    '/api/review/generate',
    {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current,
      babelDiff: args.babelDiff
    },
    baseCandidates
  );
}

export async function submitTranscriptReviewActionAnalytics(
  args: RequestBase & {
    inputBoxes: InputSnapshot;
    aiReview: GeneratedReviewResponse['llm'] | null;
    metadata: Record<string, unknown>;
  }
): Promise<unknown> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback(
    '/api/trpc/transcriptions.submitTranscriptReviewAction',
    {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current,
      babelDiff: args.babelDiff,
      inputBoxes: args.inputBoxes,
      aiReview: args.aiReview,
      metadata: args.metadata
    },
    baseCandidates
  );
}

export async function createReviewSession(args: RequestBase): Promise<ReviewSessionCreateResponse> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<ReviewSessionCreateResponse>(
    '/api/review/sessions',
    {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current,
      babelDiff: args.babelDiff
    },
    baseCandidates
  );
}

export async function getReviewSession(
  args: SessionRequestBase & {
    sessionId: string;
  }
): Promise<ReviewSessionData> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return getJsonWithFallback<ReviewSessionData>(`/api/review/sessions/${encodeURIComponent(args.sessionId)}`, baseCandidates);
}

export async function saveReviewSessionComments(
  args: SessionRequestBase & {
    sessionId: string;
    sessionComment: string;
    cardComments: Record<string, string>;
  }
): Promise<ReviewSessionData> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/comments`,
    {
      sessionComment: args.sessionComment,
      cardComments: args.cardComments
    },
    baseCandidates
  );
}

export async function generateReviewSessionSuggestions(
  args: SessionRequestBase & {
    sessionId: string;
  }
): Promise<ReviewSessionData> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/template-suggestions`,
    {},
    baseCandidates
  );
}

export async function decideReviewSessionSuggestion(
  args: SessionRequestBase & {
    sessionId: string;
    proposalId: string;
    decision: 'approved' | 'rejected';
  }
): Promise<ReviewSessionData> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<ReviewSessionData>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/template-suggestions/${encodeURIComponent(
      args.proposalId
    )}/decision`,
    {
      decision: args.decision
    },
    baseCandidates
  );
}

export async function finalizeReviewSession(
  args: SessionRequestBase & {
    sessionId: string;
    mode: 'apply' | 'skip';
  }
): Promise<ReviewSessionFinalizeResponse> {
  const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
  return postJsonWithFallback<ReviewSessionFinalizeResponse>(
    `/api/review/sessions/${encodeURIComponent(args.sessionId)}/finalize`,
    {
      mode: args.mode
    },
    baseCandidates
  );
}
