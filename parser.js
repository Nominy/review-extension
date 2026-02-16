(function () {
  "use strict";

  window.BabelReview = window.BabelReview || {};

  function parseMaybeJson(text) {
    if (typeof text !== "string") {
      return null;
    }
    const trimmed = text.trim();
    if (trimmed === "") {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  function parseTrpcFrameStream(rawText) {
    if (typeof rawText !== "string") {
      return [];
    }
    const trimmed = rawText.trim();
    if (trimmed === "") {
      return [];
    }

    const direct = parseMaybeJson(trimmed);
    if (direct !== null) {
      return Array.isArray(direct) ? direct : [direct];
    }

    const normalized = `[${trimmed.replace(/}\s*{/g, "},{")}]`;
    const streamed = parseMaybeJson(normalized);
    return Array.isArray(streamed) ? streamed : [];
  }

  function deepFindPayload(node) {
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
    if (typeof node === "object") {
      if (
        Array.isArray(node.annotations) &&
        (typeof node.actionId === "string" || typeof node.reviewActionId === "string")
      ) {
        return node;
      }
      for (const value of Object.values(node)) {
        const found = deepFindPayload(value);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizePayload(raw, capturedAt) {
    const annotationsRaw = Array.isArray(raw.annotations) ? raw.annotations : [];
    const annotations = annotationsRaw
      .map((item, idx) => ({
        id: typeof item.id === "string" ? item.id : `idx-${idx}`,
        reviewActionId: typeof item.reviewActionId === "string" ? item.reviewActionId : "",
        type: typeof item.type === "string" ? item.type : "",
        content: typeof item.content === "string" ? item.content : "",
        processedRecordingId:
          typeof item.processedRecordingId === "string" ? item.processedRecordingId : "",
        startTimeInSeconds: toNumber(item.startTimeInSeconds),
        endTimeInSeconds: toNumber(item.endTimeInSeconds),
        metadata:
          item && typeof item.metadata === "object" && item.metadata !== null ? item.metadata : null
      }))
      .sort((a, b) => a.startTimeInSeconds - b.startTimeInSeconds);

    const recordingsRaw = Array.isArray(raw.transcriptionChunkProcessedRecordings)
      ? raw.transcriptionChunkProcessedRecordings
      : [];
    const recordings = recordingsRaw
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        transcriptionChunkId:
          typeof item.transcriptionChunkId === "string" ? item.transcriptionChunkId : "",
        processedRecordingId:
          typeof item.processedRecordingId === "string" ? item.processedRecordingId : "",
        speaker: toNumber(item.speaker),
        startTimeInSeconds: toNumber(item.startTimeInSeconds),
        endTimeInSeconds: toNumber(item.endTimeInSeconds)
      }))
      .sort((a, b) => a.startTimeInSeconds - b.startTimeInSeconds);

    const lintErrors = Array.isArray(raw.lintErrors)
      ? raw.lintErrors.map((x) => ({
          annotationId: typeof x.annotationId === "string" ? x.annotationId : "",
          reason: typeof x.reason === "string" ? x.reason : "",
          severity: typeof x.severity === "string" ? x.severity : ""
        }))
      : [];

    const actionId =
      (typeof raw.actionId === "string" && raw.actionId) ||
      (annotations[0] && annotations[0].reviewActionId) ||
      "";

    return {
      actionId,
      actionLevel: toNumber(raw.actionLevel),
      actionDecision: typeof raw.actionDecision === "string" ? raw.actionDecision : "",
      annotations,
      recordings,
      lintErrors,
      capturedAt: capturedAt || new Date().toISOString()
    };
  }

  function extractNormalizedFromEntry(entry) {
    if (!entry || entry.endpoint !== "getReviewActionDataById") {
      return null;
    }
    if (entry.status && Number(entry.status) >= 400) {
      return null;
    }
    const frames = parseTrpcFrameStream(entry.responseBody || "");
    for (const frame of frames) {
      const node = frame && typeof frame === "object" && "json" in frame ? frame.json : frame;
      const rawPayload = deepFindPayload(node);
      if (rawPayload) {
        return normalizePayload(rawPayload, entry.capturedAt);
      }
    }
    return null;
  }

  window.BabelReview.parser = {
    parseMaybeJson,
    parseTrpcFrameStream,
    extractNormalizedFromEntry
  };
})();
