import type { CapturedNetworkEntry, NormalizedReviewAction, ReviewAnnotation, ReviewLintError, ReviewRecording } from '../core/types';

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

export function parseTrpcFrameStream(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  const direct = parseMaybeJson(trimmed);
  if (direct !== null) {
    return Array.isArray(direct) ? direct : [direct];
  }

  const normalized = `[${trimmed.replace(/}\s*{/g, '},{')}]`;
  const streamed = parseMaybeJson(normalized);
  return Array.isArray(streamed) ? streamed : [];
}

function deepFindPayload(node: unknown): Record<string, unknown> | null {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindPayload(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (
      Array.isArray(record.annotations) &&
      (typeof record.actionId === 'string' || typeof record.reviewActionId === 'string')
    ) {
      return record;
    }

    for (const value of Object.values(record)) {
      const found = deepFindPayload(value);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function toNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeAnnotations(raw: Record<string, unknown>): ReviewAnnotation[] {
  const annotationsRaw = Array.isArray(raw.annotations) ? raw.annotations : [];
  return annotationsRaw
    .map((item, index) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof record.id === 'string' ? record.id : `idx-${index}`,
        reviewActionId: typeof record.reviewActionId === 'string' ? record.reviewActionId : '',
        type: typeof record.type === 'string' ? record.type : '',
        content: typeof record.content === 'string' ? record.content : '',
        processedRecordingId: typeof record.processedRecordingId === 'string' ? record.processedRecordingId : '',
        startTimeInSeconds: toNumber(record.startTimeInSeconds),
        endTimeInSeconds: toNumber(record.endTimeInSeconds),
        metadata: record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : null
      };
    })
    .sort((a, b) => a.startTimeInSeconds - b.startTimeInSeconds);
}

function normalizeRecordings(raw: Record<string, unknown>): ReviewRecording[] {
  const recordingsRaw = Array.isArray(raw.transcriptionChunkProcessedRecordings)
    ? raw.transcriptionChunkProcessedRecordings
    : [];

  return recordingsRaw
    .map((item) => {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      return {
        id: typeof record.id === 'string' ? record.id : '',
        transcriptionChunkId: typeof record.transcriptionChunkId === 'string' ? record.transcriptionChunkId : '',
        processedRecordingId: typeof record.processedRecordingId === 'string' ? record.processedRecordingId : '',
        speaker: toNumber(record.speaker),
        startTimeInSeconds: toNumber(record.startTimeInSeconds),
        endTimeInSeconds: toNumber(record.endTimeInSeconds)
      };
    })
    .sort((a, b) => a.startTimeInSeconds - b.startTimeInSeconds);
}

function normalizeLintErrors(raw: Record<string, unknown>): ReviewLintError[] {
  const lintErrorsRaw = Array.isArray(raw.lintErrors) ? raw.lintErrors : [];
  return lintErrorsRaw.map((item) => {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    return {
      annotationId: typeof record.annotationId === 'string' ? record.annotationId : '',
      reason: typeof record.reason === 'string' ? record.reason : '',
      severity: typeof record.severity === 'string' ? record.severity : ''
    };
  });
}

function normalizePayload(raw: Record<string, unknown>, capturedAt: string): NormalizedReviewAction {
  const annotations = normalizeAnnotations(raw);
  const recordings = normalizeRecordings(raw);
  const lintErrors = normalizeLintErrors(raw);
  const actionId =
    (typeof raw.actionId === 'string' && raw.actionId) ||
    (annotations[0] && annotations[0].reviewActionId) ||
    '';

  return {
    actionId,
    actionLevel: toNumber(raw.actionLevel),
    actionDecision: typeof raw.actionDecision === 'string' ? raw.actionDecision : '',
    annotations,
    recordings,
    lintErrors,
    capturedAt
  };
}

export function extractNormalizedFromEntry(entry: CapturedNetworkEntry): NormalizedReviewAction | null {
  if (entry.endpoint !== 'getReviewActionDataById') {
    return null;
  }

  if (typeof entry.status === 'number' && entry.status >= 400) {
    return null;
  }

  const frames = parseTrpcFrameStream(entry.responseBody || '');
  for (const frame of frames) {
    const node =
      frame && typeof frame === 'object' && 'json' in (frame as Record<string, unknown>)
        ? (frame as Record<string, unknown>).json
        : frame;
    const rawPayload = deepFindPayload(node);
    if (rawPayload) {
      return normalizePayload(rawPayload, entry.capturedAt);
    }
  }

  return null;
}
