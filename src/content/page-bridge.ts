import {
  COMMAND_FETCH_CURRENT_REVIEW_ACTION,
  COMMAND_FETCH_REVIEW_ACTION,
  COMMAND_FETCH_TRANSCRIPTION_DIFF,
  COMMAND_PREFILL_REVIEWER_RATINGS,
  COMMAND_SOURCE,
  EVENT_REVIEW_ACTION_CAPTURED,
  EVENT_SOURCE,
  EVENT_TRANSCRIPTION_DIFF_FETCHED
} from '../core/constants';
import { parseMaybeJson, parseTrpcFrameStream } from '../parsers/review-action-parser';

const CLAIM_NEEDLE = 'claimNextReviewActionFromReviewQueue';
const REVIEW_DATA_NEEDLE = 'getReviewActionDataById';
const DEFAULT_TARGET_NEEDLES = [CLAIM_NEEDLE, REVIEW_DATA_NEEDLE, 'submitTranscriptReviewAction'];
const REVIEW_ACTIONS_PROCEDURE = 'transcriptions.getReviewActionsForChunk';
const TRANSCRIPTION_DIFF_PROCEDURE = 'transcriptions.getTranscriptionDiff';
const REVIEW_ACTION_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BODY_LENGTH = 120000;
const REVIEW_ACTION_MAX_BODY_LENGTH = 1500000;

type CommandMessage = {
  source?: string;
  type?: string;
  reviewActionId?: string;
  transcriptionChunkId?: string;
};

interface HelperMeta {
  method: string;
  url: string;
  startedAtMs: number;
  requestBody: string;
}

interface ReviewActionIdCandidate {
  reviewActionId: string;
  level: number | null;
  source: string;
}

interface BabelHelperXmlHttpRequest extends XMLHttpRequest {
  __babelHelper?: HelperMeta;
}

interface ReactHookQueue {
  dispatch?: unknown;
  lastRenderedReducer?: unknown;
  lastRenderedState?: unknown;
}

interface ReactHook {
  memoizedState?: unknown;
  queue?: ReactHookQueue | null;
}

interface ReactFiber {
  alternate?: ReactFiber | null;
  memoizedProps?: unknown;
  memoizedState?: ReactHook | null;
  return?: ReactFiber | null;
  stateNode?: unknown;
  tag?: number;
}

interface FeedbackOwnerResolution {
  fiber: ReactFiber;
  hook: ReactHook;
  initialFeedback: unknown;
  queue: ReactHookQueue;
  reviewActionId: string;
  state: Record<string, unknown>;
}

interface FeedbackStabilityMarker {
  initialFeedback: unknown;
  reviewActionId: string;
}

function parseTargetNeedles(raw: string): string[] {
  if (!raw) {
    return DEFAULT_TARGET_NEEDLES;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const clean = parsed.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
      return clean.length ? clean : DEFAULT_TARGET_NEEDLES;
    }
  } catch {
    return DEFAULT_TARGET_NEEDLES;
  }

  return DEFAULT_TARGET_NEEDLES;
}

const currentScript = document.currentScript as HTMLScriptElement | null;
const targetNeedles = parseTargetNeedles(currentScript?.dataset?.targetNeedles || '');
const autoFetchedActionIds = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function getMaxBodyLength(endpoint: string): number {
  if (endpoint === REVIEW_DATA_NEEDLE) {
    return REVIEW_ACTION_MAX_BODY_LENGTH;
  }
  return DEFAULT_MAX_BODY_LENGTH;
}

function clip(text: string, endpoint: string): string {
  const limit = getMaxBodyLength(endpoint);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n...[truncated ${text.length - limit} chars]`;
}

function stringifyBody(body: unknown): string {
  if (body == null) {
    return '';
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof FormData) {
    const pairs: Array<[string, string]> = [];
    body.forEach((value, key) => {
      if (typeof value === 'string') {
        pairs.push([key, value]);
      } else {
        pairs.push([key, `[blob:${value.type || 'application/octet-stream'}:${value.size}]`]);
      }
    });
    return JSON.stringify(pairs);
  }
  if (body instanceof Blob) {
    return `[blob:${body.type || 'application/octet-stream'}:${body.size}]`;
  }
  if (body instanceof ArrayBuffer) {
    return `[arrayBuffer:${body.byteLength}]`;
  }
  if (ArrayBuffer.isView(body)) {
    return `[typedArray:${body.byteLength}]`;
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function safeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function detectEndpoint(url: string): string {
  for (const needle of targetNeedles) {
    if (url.includes(needle)) {
      return needle;
    }
  }
  return '';
}

function postPayload(type: string, payload: unknown): void {
  window.postMessage(
    {
      source: EVENT_SOURCE,
      type,
      payload
    },
    '*'
  );
}

function normalizeReviewActionId(value: unknown): string {
  return typeof value === 'string' && REVIEW_ACTION_ID_REGEX.test(value) ? value : '';
}

function findReviewActionIdByKeyDeep(node: unknown): string {
  if (!node) {
    return '';
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findReviewActionIdByKeyDeep(item);
      if (found) {
        return found;
      }
    }
    return '';
  }

  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const actionId = normalizeReviewActionId(record.actionId);
    if (actionId) {
      return actionId;
    }

    const reviewActionId = normalizeReviewActionId(record.reviewActionId);
    if (reviewActionId) {
      return reviewActionId;
    }

    for (const value of Object.values(record)) {
      const found = findReviewActionIdByKeyDeep(value);
      if (found) {
        return found;
      }
    }
  }

  return '';
}

function extractReviewActionIdFromRequestBody(requestBodyText: string, endpoint: string): string {
  if (endpoint === CLAIM_NEEDLE) {
    return '';
  }

  const parsed = parseMaybeJson(requestBodyText);
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  const batched = (parsed as Record<string, unknown>)['0'];
  if (batched && typeof batched === 'object') {
    const json = (batched as Record<string, unknown>).json;
    if (json && typeof json === 'object' && typeof (json as Record<string, unknown>).reviewActionId === 'string') {
      return normalizeReviewActionId((json as Record<string, unknown>).reviewActionId);
    }
  }

  return findReviewActionIdByKeyDeep(parsed);
}

function extractReviewActionIdFromResponseText(responseText: string): string {
  const frames = parseTrpcFrameStream(responseText);
  for (const frame of frames) {
    if (frame && typeof frame === 'object' && 'json' in (frame as Record<string, unknown>)) {
      const inJson = findReviewActionIdByKeyDeep((frame as Record<string, unknown>).json);
      if (inJson) {
        return inJson;
      }
    }

    const inFrame = findReviewActionIdByKeyDeep(frame);
    if (inFrame) {
      return inFrame;
    }
  }
  return '';
}

function extractCapturedReviewActionId(
  endpoint: string,
  requestBody: string,
  responseBody: string
): { reviewActionId: string; extractedFrom: string } {
  if (endpoint !== CLAIM_NEEDLE) {
    const reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
    if (reviewActionId) {
      return { reviewActionId, extractedFrom: 'request' };
    }
  }

  const reviewActionId = extractReviewActionIdFromResponseText(responseBody);
  return { reviewActionId, extractedFrom: reviewActionId ? 'response' : '' };
}

function extractReviewActionIdFromTrpcInputUrl(urlText: string): string {
  try {
    const url = new URL(urlText, window.location.href);
    const input = url.searchParams.get('input');
    if (!input) {
      return '';
    }
    return findReviewActionIdByKeyDeep(parseMaybeJson(input));
  } catch {
    return '';
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function candidateFromRecord(record: Record<string, unknown>, source: string): ReviewActionIdCandidate | null {
  const reviewActionId = normalizeReviewActionId(record.reviewActionId) || normalizeReviewActionId(record.actionId);
  if (!reviewActionId) {
    return null;
  }

  const level =
    toFiniteNumber(record.reviewActionLevel) ?? toFiniteNumber(record.actionLevel) ?? toFiniteNumber(record.level);
  return { reviewActionId, level, source };
}

function preferCandidate(
  current: ReviewActionIdCandidate | null,
  candidate: ReviewActionIdCandidate | null
): ReviewActionIdCandidate | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  if ((candidate.level ?? 0) > (current.level ?? 0)) {
    return candidate;
  }
  return current;
}

function findReviewActionCandidateDeep(
  node: unknown,
  source: string,
  seen: WeakSet<object>,
  depth: number
): ReviewActionIdCandidate | null {
  if (!node || depth > 8) {
    return null;
  }
  if (typeof node !== 'object' && typeof node !== 'function') {
    return null;
  }
  if ((typeof Node !== 'undefined' && node instanceof Node) || seen.has(node)) {
    return null;
  }

  seen.add(node);
  if (Array.isArray(node)) {
    let best: ReviewActionIdCandidate | null = null;
    for (let index = 0; index < Math.min(node.length, 50); index += 1) {
      best = preferCandidate(best, findReviewActionCandidateDeep(node[index], source, seen, depth + 1));
      if ((best?.level ?? 0) >= 2) {
        return best;
      }
    }
    return best;
  }

  const record = node as Record<string, unknown>;
  const direct = candidateFromRecord(record, source);
  if ((direct?.level ?? 0) >= 2) {
    return direct;
  }

  let best = direct;
  for (const key of Object.keys(record).slice(0, 80)) {
    if (
      key === 'return' ||
      key === 'child' ||
      key === 'sibling' ||
      key === 'alternate' ||
      key === 'stateNode' ||
      key === '_debugOwner'
    ) {
      continue;
    }
    best = preferCandidate(best, findReviewActionCandidateDeep(record[key], source, seen, depth + 1));
    if ((best?.level ?? 0) >= 2) {
      return best;
    }
  }

  return best;
}

function findReviewActionCandidateInReactValue(value: unknown, source: string): ReviewActionIdCandidate | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const roots = [
    record.pendingProps,
    (record.pendingProps as Record<string, unknown> | undefined)?.children,
    ((record.pendingProps as Record<string, unknown> | undefined)?.children as Record<string, unknown> | undefined)?.props,
    record.memoizedProps,
    (record.memoizedProps as Record<string, unknown> | undefined)?.children,
    ((record.memoizedProps as Record<string, unknown> | undefined)?.children as Record<string, unknown> | undefined)?.props,
    record.props,
    value
  ];

  let best: ReviewActionIdCandidate | null = null;
  const seen = new WeakSet<object>();
  for (const root of roots) {
    best = preferCandidate(best, findReviewActionCandidateDeep(root, source, seen, 0));
    if ((best?.level ?? 0) >= 2) {
      return best;
    }
  }

  return best;
}

function findCurrentReviewActionIdFromReactInternals(): string {
  let best: ReviewActionIdCandidate | null = null;
  const elements =
    typeof document.querySelectorAll === 'function' ? Array.from(document.querySelectorAll('*')) : [];

  for (const element of elements) {
    for (const key of Object.keys(element)) {
      if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactProps$')) {
        continue;
      }
      best = preferCandidate(
        best,
        findReviewActionCandidateInReactValue((element as unknown as Record<string, unknown>)[key], 'react')
      );
      if (best && (best.level ?? 0) >= 2) {
        return best.reviewActionId;
      }
    }
  }

  return best?.reviewActionId || '';
}


function findCurrentReviewActionIdFromVisibleText(): string {
  const candidates = [window.getSelection?.()?.toString() || '', document.body?.innerText || ''];
  const labeledIdRegex =
    /\b(?:ID|Review(?:\s+Action)?\s+ID|Support\s+ID)\s*:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/i;

  for (const candidate of candidates) {
    const reviewActionId = normalizeReviewActionId(candidate.match(labeledIdRegex)?.[1]);
    if (reviewActionId) {
      return reviewActionId;
    }
  }

  return '';
}

function findCurrentReviewActionIdFromNextPayload(): string {
  const reviewIdRegex =
    /reviewActionId(?:\\{0,3}")?\s*(?:\\{0,3}:|:)\s*\\{0,3}"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;
  const levelTwoRegex = /(?:reviewActionLevel|actionLevel|level)(?:\\{0,3}")?\s*(?:\\{0,3}:|:)\s*2\b/i;
  let fallback = '';

  for (const script of Array.from(document.scripts)) {
    const text = script.textContent || '';
    for (const match of text.matchAll(reviewIdRegex)) {
      const reviewActionId = normalizeReviewActionId(match[1]);
      if (!reviewActionId) {
        continue;
      }
      if (!fallback) {
        fallback = reviewActionId;
      }
      const context = text.slice(Math.max(0, match.index - 500), match.index + 500);
      if (levelTwoRegex.test(context)) {
        return reviewActionId;
      }
    }
  }

  return fallback;
}

function findCurrentReviewActionIdFromPerformance(): string {
  const entries = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name || '')
    .filter((url) => url.includes(REVIEW_ACTIONS_PROCEDURE));

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const reviewActionId = extractReviewActionIdFromTrpcInputUrl(entries[index]);
    if (reviewActionId) {
      return reviewActionId;
    }
  }

  return '';
}

function findCurrentReviewActionIdFromPageContext(): { reviewActionId: string; source: string } {
  const sources: Array<[string, () => string]> = [
    ['react-page-context', findCurrentReviewActionIdFromReactInternals],
    ['visible-support-id', findCurrentReviewActionIdFromVisibleText],
    ['performance', findCurrentReviewActionIdFromPerformance],
    ['next-page-payload', findCurrentReviewActionIdFromNextPayload]
  ];

  for (const [source, find] of sources) {
    const reviewActionId = find();
    if (reviewActionId) {
      return { reviewActionId, source };
    }
  }

  return { reviewActionId: '', source: '' };
}


const originalFetch = window.fetch;

async function maybeAutoFetchReviewActionData(
  reviewActionId: string,
  originEndpoint: string,
  originUrl: string,
  force: boolean
): Promise<void> {
  if (!REVIEW_ACTION_ID_REGEX.test(reviewActionId)) {
    return;
  }
  if (!force && autoFetchedActionIds.has(reviewActionId)) {
    return;
  }

  autoFetchedActionIds.add(reviewActionId);

  const startedAtMs = Date.now();
  const url = '/api/trpc/transcriptions.getReviewActionDataById?batch=1';
  const bodyText = JSON.stringify({
    0: {
      json: {
        reviewActionId
      }
    }
  });

  try {
    const response = await originalFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: bodyText
    });

    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch (error) {
      responseBody = `[unreadable response body: ${error instanceof Error ? error.message : String(error)}]`;
    }

      postPayload(EVENT_REVIEW_ACTION_CAPTURED, {
        transport: 'fetch',
        endpoint: REVIEW_DATA_NEEDLE,
        method: 'POST',
        url,
        status: response.status,
        ok: response.ok,
        requestBody: clip(bodyText, REVIEW_DATA_NEEDLE),
        responseBody: clip(responseBody, REVIEW_DATA_NEEDLE),
      durationMs: Date.now() - startedAtMs,
      capturedAt: nowIso(),
      extractedReviewActionId: reviewActionId,
      autoFetch: true,
      manualTrigger: force,
      triggeredByEndpoint: originEndpoint,
      triggeredByUrl: originUrl
    });
  } catch (error) {
      postPayload(EVENT_REVIEW_ACTION_CAPTURED, {
        transport: 'fetch',
        endpoint: REVIEW_DATA_NEEDLE,
        method: 'POST',
        url,
        status: null,
        ok: false,
        requestBody: clip(bodyText, REVIEW_DATA_NEEDLE),
        responseBody: `[auto fetch error: ${error instanceof Error ? error.message : String(error)}]`,
      durationMs: Date.now() - startedAtMs,
      capturedAt: nowIso(),
      extractedReviewActionId: reviewActionId,
      autoFetch: true,
      manualTrigger: force,
      triggeredByEndpoint: originEndpoint,
      triggeredByUrl: originUrl
    });
  }
}

function buildTrpcBatchGetUrl(procedurePath: string, input: unknown): string {
  return `/api/trpc/${procedurePath}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
}

function extractTrpcJsonResult(payload: unknown, index: number): unknown {
  if (!Array.isArray(payload)) {
    return null;
  }

  const item = payload[index];
  if (
    item &&
    typeof item === 'object' &&
    'result' in item &&
    typeof item.result === 'object' &&
    item.result &&
    'data' in item.result &&
    typeof item.result.data === 'object' &&
    item.result.data &&
    'json' in item.result.data
  ) {
    return item.result.data.json;
  }

  return null;
}

async function fetchTranscriptionDiffForReviewAction(args: {
  reviewActionId?: string;
  transcriptionChunkId?: string;
}): Promise<void> {
  const reviewActionId = normalizeReviewActionId(args.reviewActionId);
  const transcriptionChunkId = typeof args.transcriptionChunkId === 'string' ? args.transcriptionChunkId : '';

  if (!reviewActionId) {
    throw new Error('Valid current reviewActionId is required.');
  }

  const reviewActionsUrl = buildTrpcBatchGetUrl(REVIEW_ACTIONS_PROCEDURE, {
    0: {
      json: {
        reviewActionId
      }
    }
  });

  const reviewActionsResponse = await originalFetch(reviewActionsUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });

  if (!reviewActionsResponse.ok) {
    throw new Error(`getReviewActionsForChunk failed with HTTP ${reviewActionsResponse.status}`);
  }

  const reviewActionsPayload = await reviewActionsResponse.json();
  const reviewActions = extractTrpcJsonResult(reviewActionsPayload, 0);
  if (!Array.isArray(reviewActions)) {
    throw new Error('getReviewActionsForChunk returned unexpected payload.');
  }

  const reference = reviewActions.find((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const record = item as Record<string, unknown>;
    return Number(record.level) === 1 && Boolean(normalizeReviewActionId(record.id));
  }) as Record<string, unknown> | undefined;

  if (!reference || typeof reference.id !== 'string') {
    throw new Error('Could not find L1 review action for current L2 task.');
  }

  const diffUrl = buildTrpcBatchGetUrl(TRANSCRIPTION_DIFF_PROCEDURE, {
    0: {
      json: {
        referenceReviewActionId: reference.id,
        currentReviewActionId: reviewActionId
      }
    }
  });

  const diffResponse = await originalFetch(diffUrl, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });

  if (!diffResponse.ok) {
    throw new Error(`getTranscriptionDiff failed with HTTP ${diffResponse.status}`);
  }

  const diffPayload = await diffResponse.json();
  postPayload(EVENT_TRANSCRIPTION_DIFF_FETCHED, {
    ok: true,
    currentReviewActionId: reviewActionId,
    referenceReviewActionId: reference.id,
    transcriptionChunkId,
    reviewActionsUrl,
    diffUrl,
    reviewActionsPayload,
    diffPayload,
    capturedAt: nowIso()
  });
}

async function readFetchRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (init && Object.prototype.hasOwnProperty.call(init, 'body')) {
    return stringifyBody(init.body);
  }
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch (error) {
      return `[unreadable request body: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  return '';
}

function maybeTriggerFollowup(endpoint: string, reviewActionId: string, url: string): void {
  if (endpoint === CLAIM_NEEDLE && reviewActionId) {
    void maybeAutoFetchReviewActionData(reviewActionId, endpoint, url, false);
  }
}

window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = safeUrl(input);
  const endpoint = detectEndpoint(url);
  const shouldCapture = endpoint !== '';
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  const startedAtMs = Date.now();
  let requestBody = '';

  if (shouldCapture) {
    requestBody = await readFetchRequestBody(input, init);
  }

  try {
    const response = await originalFetch.apply(this, [input, init] as [RequestInfo | URL, RequestInit | undefined]);

    if (shouldCapture) {
      let responseBody = '';
      try {
        responseBody = await response.clone().text();
      } catch (error) {
        responseBody = `[unreadable response body: ${error instanceof Error ? error.message : String(error)}]`;
      }

      const { reviewActionId, extractedFrom } = extractCapturedReviewActionId(endpoint, requestBody, responseBody);

      postPayload(EVENT_REVIEW_ACTION_CAPTURED, {
        transport: 'fetch',
        endpoint,
        method,
        url,
        status: response.status,
        ok: response.ok,
        requestBody: clip(requestBody, endpoint),
        responseBody: clip(responseBody, endpoint),
        durationMs: Date.now() - startedAtMs,
        capturedAt: nowIso(),
        extractedReviewActionId: reviewActionId || '',
        extractedFrom
      });

      maybeTriggerFollowup(endpoint, reviewActionId, url);
    }

    return response;
  } catch (error) {
    if (shouldCapture) {
      const reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
      postPayload(EVENT_REVIEW_ACTION_CAPTURED, {
        transport: 'fetch',
        endpoint,
        method,
        url,
        status: null,
        ok: false,
        requestBody: clip(requestBody, endpoint),
        responseBody: `[fetch error: ${error instanceof Error ? error.message : String(error)}]`,
        durationMs: Date.now() - startedAtMs,
        capturedAt: nowIso(),
        extractedReviewActionId: reviewActionId || '',
        extractedFrom: reviewActionId ? 'request' : ''
      });
    }
    throw error;
  }
};

const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function patchedOpen(
  this: BabelHelperXmlHttpRequest,
  method: string,
  url: string | URL
): ReturnType<typeof originalOpen> {
  this.__babelHelper = {
    method: method || 'GET',
    url: typeof url === 'string' ? url : String(url || ''),
    startedAtMs: 0,
    requestBody: ''
  };
  return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
};

XMLHttpRequest.prototype.send = function patchedSend(
  this: BabelHelperXmlHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null
): ReturnType<typeof originalSend> {
  const meta = this.__babelHelper || {
    method: 'GET',
    url: '',
    startedAtMs: 0,
    requestBody: ''
  };

  meta.startedAtMs = Date.now();
  meta.requestBody = stringifyBody(body);
  this.__babelHelper = meta;

  const endpoint = detectEndpoint(meta.url);
  if (endpoint) {
    this.addEventListener('loadend', () => {
      let responseBody = '';
      try {
        responseBody =
          this.responseType === '' || this.responseType === 'text'
            ? this.responseText || ''
            : `[non-text xhr responseType: ${this.responseType}]`;
      } catch (error) {
        responseBody = `[unreadable xhr response: ${error instanceof Error ? error.message : String(error)}]`;
      }

      const { reviewActionId, extractedFrom } = extractCapturedReviewActionId(endpoint, meta.requestBody, responseBody);

      postPayload(EVENT_REVIEW_ACTION_CAPTURED, {
        transport: 'xhr',
        endpoint,
        method: meta.method,
        url: meta.url,
        status: this.status || null,
        ok: typeof this.status === 'number' ? this.status >= 200 && this.status < 300 : false,
        requestBody: clip(meta.requestBody, endpoint),
        responseBody: clip(responseBody, endpoint),
        durationMs: Date.now() - meta.startedAtMs,
        capturedAt: nowIso(),
        extractedReviewActionId: reviewActionId || '',
        extractedFrom
      });

      maybeTriggerFollowup(endpoint, reviewActionId, meta.url);
    });
  }

  return originalSend.apply(this, [body] as Parameters<typeof originalSend>);
};

let reviewerRatingPrefillPending = false;

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRatingState(value: unknown): value is Record<string, unknown> {
  const state = asObjectRecord(value);
  if (!state || !hasOwn(state, 'otherFeedback') || typeof state.otherFeedback !== 'string') {
    return false;
  }

  let ratingEntryCount = 0;
  for (const [key, entry] of Object.entries(state)) {
    if (key === 'otherFeedback') {
      continue;
    }

    const ratingEntry = asObjectRecord(entry);
    if (
      !ratingEntry ||
      !hasOwn(ratingEntry, 'rating') ||
      !hasOwn(ratingEntry, 'comment') ||
      (ratingEntry.rating !== null &&
        (typeof ratingEntry.rating !== 'number' || !Number.isFinite(ratingEntry.rating))) ||
      typeof ratingEntry.comment !== 'string'
    ) {
      return false;
    }
    ratingEntryCount += 1;
  }

  return ratingEntryCount > 1;
}

function hasNullRating(state: Record<string, unknown>): boolean {
  return Object.values(state).some((entry) => {
    const ratingEntry = asObjectRecord(entry);
    return Boolean(ratingEntry && ratingEntry.rating === null);
  });
}

function ascendToHostRoot(fiber: ReactFiber): ReactFiber | null {
  const seen = new Set<ReactFiber>();
  let root = fiber;

  while (true) {
    if (seen.has(root)) {
      return null;
    }
    seen.add(root);

    const parent = root.return;
    if (!parent) {
      break;
    }
    root = parent;
  }

  return root.tag === 3 ? root : null;
}

function isCurrentFiberBranch(fiber: ReactFiber): boolean {
  const hostRoot = ascendToHostRoot(fiber);
  const fiberRoot = hostRoot ? asObjectRecord(hostRoot.stateNode) : null;
  return Boolean(fiberRoot && fiberRoot.current === hostRoot);
}

function resolveCommittedFiber(fiber: ReactFiber): ReactFiber | null {
  if (isCurrentFiberBranch(fiber)) {
    return fiber;
  }

  const alternate = fiber.alternate;
  return alternate &&
    alternate !== fiber &&
    typeof alternate === 'object' &&
    isCurrentFiberBranch(alternate)
    ? alternate
    : null;
}

function hasReviewerLevelAncestor(owner: ReactFiber): boolean {
  const seen = new Set<ReactFiber>();
  let ancestor = owner.return ?? null;

  while (ancestor && !seen.has(ancestor)) {
    seen.add(ancestor);
    const props = asObjectRecord(ancestor.memoizedProps);
    if (
      props &&
      typeof props.reviewActionLevel === 'number' &&
      Number.isFinite(props.reviewActionLevel) &&
      props.reviewActionLevel > 1
    ) {
      return true;
    }
    ancestor = ancestor.return ?? null;
  }

  return false;
}

function resolveFeedbackOwnerFiber(fiber: ReactFiber): FeedbackOwnerResolution | null {
  const props = asObjectRecord(fiber.memoizedProps);
  if (
    !props ||
    !hasOwn(props, 'reviewActionId') ||
    typeof props.reviewActionId !== 'string' ||
    props.reviewActionId.length === 0 ||
    !hasOwn(props, 'initialFeedback') ||
    props.readOnly !== false ||
    props.isOpen !== true ||
    props.isLoading !== false ||
    !hasReviewerLevelAncestor(fiber)
  ) {
    return null;
  }

  const hook = fiber.memoizedState;
  const state = hook?.memoizedState;
  const queue = hook?.queue;
  const queueRecord = queue as unknown as Record<string, unknown> | null | undefined;
  const hasInvalidLastRenderedState = Boolean(
    queueRecord &&
      hasOwn(queueRecord, 'lastRenderedState') &&
      !isRatingState(queueRecord.lastRenderedState)
  );
  if (
    !hook ||
    !queue ||
    !isRatingState(state) ||
    hasInvalidLastRenderedState ||
    typeof queue.lastRenderedReducer !== 'function' ||
    typeof queue.dispatch !== 'function'
  ) {
    return null;
  }

  return {
    fiber,
    hook,
    initialFeedback: props.initialFeedback,
    queue,
    reviewActionId: props.reviewActionId,
    state
  };
}

function sameFeedbackOwner(
  left: FeedbackOwnerResolution,
  right: FeedbackOwnerResolution
): boolean {
  return (
    (left.fiber === right.fiber || left.queue === right.queue) &&
    left.reviewActionId === right.reviewActionId &&
    left.initialFeedback === right.initialFeedback
  );
}

function collectFeedbackOwnersFromFiber(
  start: ReactFiber,
  owners: FeedbackOwnerResolution[]
): void {
  const seen = new Set<ReactFiber>();
  let fiber: ReactFiber | null = start;

  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    const owner = resolveFeedbackOwnerFiber(fiber);
    if (owner && !owners.some((existing) => sameFeedbackOwner(existing, owner))) {
      owners.push(owner);
    }
    fiber = fiber.return ?? null;
  }
}

function resolveFeedbackOwner(): FeedbackOwnerResolution | null {
  const owners: FeedbackOwnerResolution[] = [];
  const anchors = document.querySelectorAll('[role="radio"][value="1"]');

  for (const anchor of Array.from(anchors)) {
    for (const key of Object.keys(anchor)) {
      if (!key.startsWith('__reactFiber$')) {
        continue;
      }

      const fiber = (anchor as unknown as Record<string, unknown>)[key] as ReactFiber | undefined;
      if (!fiber || typeof fiber !== 'object') {
        continue;
      }

      const committedFiber = resolveCommittedFiber(fiber);
      if (!committedFiber) {
        continue;
      }

      collectFeedbackOwnersFromFiber(committedFiber, owners);
    }
  }

  return owners.length === 1 ? owners[0] : null;
}

function isSameFeedbackMarker(
  left: FeedbackStabilityMarker,
  right: FeedbackStabilityMarker | null
): boolean {
  return Boolean(
    right &&
      left.reviewActionId === right.reviewActionId &&
      left.initialFeedback === right.initialFeedback
  );
}

function prefillNullRatings(previous: unknown): unknown {
  if (!isRatingState(previous)) {
    return previous;
  }

  let next: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(previous)) {
    const ratingEntry = asObjectRecord(entry);
    if (!ratingEntry || !hasOwn(ratingEntry, 'rating') || ratingEntry.rating != null) {
      continue;
    }

    next ??= { ...previous };
    next[key] = { ...ratingEntry, rating: 1 };
  }

  return next ?? previous;
}

function finishReviewerRatingPrefill(): void {
  reviewerRatingPrefillPending = false;
}

function sampleReviewerRatingPrefill(marker: FeedbackStabilityMarker | null): void {
  try {
    requestAnimationFrame(() => {
      try {
        const owner = resolveFeedbackOwner();
        if (!owner) {
          finishReviewerRatingPrefill();
          return;
        }

        const currentMarker: FeedbackStabilityMarker = {
          initialFeedback: owner.initialFeedback,
          reviewActionId: owner.reviewActionId
        };
        if (!marker || !isSameFeedbackMarker(marker, currentMarker)) {
          sampleReviewerRatingPrefill(currentMarker);
          return;
        }

        if (!hasNullRating(owner.state)) {
          finishReviewerRatingPrefill();
          return;
        }

        const dispatch = owner.queue.dispatch as (
          update: (previous: unknown) => unknown
        ) => void;
        dispatch(prefillNullRatings);
        finishReviewerRatingPrefill();
      } catch {
        finishReviewerRatingPrefill();
      }
    });
  } catch {
    finishReviewerRatingPrefill();
  }
}

function scheduleReviewerRatingPrefill(): void {
  if (reviewerRatingPrefillPending) {
    return;
  }

  reviewerRatingPrefillPending = true;
  sampleReviewerRatingPrefill(null);
}

function handleCommand(event: MessageEvent): void {
  if (event.source !== window) {
    return;
  }

  const data = event.data as CommandMessage | null;
  if (!data || data.source !== COMMAND_SOURCE) {
    return;
  }

  if (data.type === COMMAND_PREFILL_REVIEWER_RATINGS) {
    scheduleReviewerRatingPrefill();
    return;
  }

  if (data.type === COMMAND_FETCH_CURRENT_REVIEW_ACTION) {
    const { reviewActionId } = findCurrentReviewActionIdFromPageContext();
    if (reviewActionId) {
      void maybeAutoFetchReviewActionData(reviewActionId, 'page-context', window.location.href, true);
    }
    return;
  }

  if (data.type === COMMAND_FETCH_REVIEW_ACTION) {
    const reviewActionId = normalizeReviewActionId(data.reviewActionId);
    if (reviewActionId) {
      void maybeAutoFetchReviewActionData(reviewActionId, 'manual', window.location.href, true);
    }
    return;
  }

  if (data.type === COMMAND_FETCH_TRANSCRIPTION_DIFF) {
    void fetchTranscriptionDiffForReviewAction(data).catch((error) => {
      postPayload(EVENT_TRANSCRIPTION_DIFF_FETCHED, {
        ok: false,
        currentReviewActionId: typeof data.reviewActionId === 'string' ? data.reviewActionId : '',
        transcriptionChunkId: typeof data.transcriptionChunkId === 'string' ? data.transcriptionChunkId : '',
        error: error instanceof Error ? error.message : String(error),
        capturedAt: nowIso()
      });
    });
  }
}

if (!window.__babelReviewPageBridgeInstalled) {
  window.__babelReviewPageBridgeInstalled = true;
  window.addEventListener('message', handleCommand);
}
