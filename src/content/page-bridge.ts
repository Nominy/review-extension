import {
  COMMAND_FETCH_REVIEW_ACTION,
  COMMAND_FETCH_TRANSCRIPTION_DIFF,
  COMMAND_SOURCE,
  EVENT_REVIEW_ACTION_CAPTURED,
  EVENT_SOURCE,
  EVENT_TRANSCRIPTION_DIFF_FETCHED
} from '../core/constants';

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

interface InterceptorMeta {
  method: string;
  url: string;
  startedAtMs: number;
  requestBody: string;
}

interface BabelInterceptorXmlHttpRequest extends XMLHttpRequest {
  __babelInterceptor?: InterceptorMeta;
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

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseTrpcFrameStream(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  const direct = parseMaybeJson(trimmed);
  if (direct !== null) {
    return Array.isArray(direct) ? direct : [direct];
  }

  const normalized = `[${trimmed.replace(/}\s*{/g, '},{')}]`;
  const stream = parseMaybeJson(normalized);
  return Array.isArray(stream) ? stream : [];
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
  const parsed = parseMaybeJson(requestBodyText);
  if (!parsed || typeof parsed !== 'object') {
    return '';
  }

  if (endpoint === CLAIM_NEEDLE) {
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
  if (!transcriptionChunkId) {
    throw new Error('transcriptionChunkId is required.');
  }

  const reviewActionsUrl = buildTrpcBatchGetUrl(REVIEW_ACTIONS_PROCEDURE, {
    0: {
      json: {
        transcriptionChunkId,
        excludeReviewActionId: reviewActionId
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
    throw new Error('Could not find L1 review action for chunk.');
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

      let reviewActionId = '';
      let extractedFrom = '';
      if (endpoint === CLAIM_NEEDLE) {
        reviewActionId = extractReviewActionIdFromResponseText(responseBody);
        extractedFrom = reviewActionId ? 'response' : '';
        if (!reviewActionId) {
          reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
          extractedFrom = reviewActionId ? 'request' : '';
        }
      } else {
        reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
        extractedFrom = reviewActionId ? 'request' : '';
        if (!reviewActionId) {
          reviewActionId = extractReviewActionIdFromResponseText(responseBody);
          extractedFrom = reviewActionId ? 'response' : '';
        }
      }

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
  this: BabelInterceptorXmlHttpRequest,
  method: string,
  url: string | URL
): ReturnType<typeof originalOpen> {
  this.__babelInterceptor = {
    method: method || 'GET',
    url: typeof url === 'string' ? url : String(url || ''),
    startedAtMs: 0,
    requestBody: ''
  };
  return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
};

XMLHttpRequest.prototype.send = function patchedSend(
  this: BabelInterceptorXmlHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null
): ReturnType<typeof originalSend> {
  const meta = this.__babelInterceptor || {
    method: 'GET',
    url: '',
    startedAtMs: 0,
    requestBody: ''
  };

  meta.startedAtMs = Date.now();
  meta.requestBody = stringifyBody(body);
  this.__babelInterceptor = meta;

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

      let reviewActionId = '';
      let extractedFrom = '';
      if (endpoint === CLAIM_NEEDLE) {
        reviewActionId = extractReviewActionIdFromResponseText(responseBody);
        extractedFrom = reviewActionId ? 'response' : '';
        if (!reviewActionId) {
          reviewActionId = extractReviewActionIdFromRequestBody(meta.requestBody, endpoint);
          extractedFrom = reviewActionId ? 'request' : '';
        }
      } else {
        reviewActionId = extractReviewActionIdFromRequestBody(meta.requestBody, endpoint);
        extractedFrom = reviewActionId ? 'request' : '';
        if (!reviewActionId) {
          reviewActionId = extractReviewActionIdFromResponseText(responseBody);
          extractedFrom = reviewActionId ? 'response' : '';
        }
      }

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

function handleCommand(event: MessageEvent): void {
  if (event.source !== window) {
    return;
  }

  const data = event.data as CommandMessage | null;
  if (!data || data.source !== COMMAND_SOURCE) {
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
