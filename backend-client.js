(function () {
  "use strict";

  window.BabelReview = window.BabelReview || {};

  class HttpStatusError extends Error {
    constructor(message) {
      super(message);
      this.name = "HttpStatusError";
    }
  }

  function normalizeBaseUrl(value) {
    const raw = (value || "").trim();
    if (!raw) {
      return "";
    }
    return raw.replace(/\/+$/, "");
  }

  function uniq(values) {
    const out = [];
    for (const item of values || []) {
      if (!out.includes(item)) {
        out.push(item);
      }
    }
    return out;
  }

  function buildBaseCandidates(primary, fallbacks) {
    const values = [primary].concat(Array.isArray(fallbacks) ? fallbacks : []);
    return uniq(values.map(normalizeBaseUrl).filter(Boolean));
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      const err =
        (data && typeof data.error === "string" && data.error) ||
        `HTTP ${response.status}: ${text.slice(0, 240)}`;
      throw new HttpStatusError(err);
    }

    if (!data || typeof data !== "object") {
      throw new Error("Backend returned non-JSON payload.");
    }

    return data;
  }

  async function postJsonWithFallback(path, payload, baseCandidates) {
    if (!Array.isArray(baseCandidates) || !baseCandidates.length) {
      throw new Error("Backend URL is required.");
    }

    const errors = [];
    for (const base of baseCandidates) {
      try {
        return await postJson(`${base}${path}`, payload);
      } catch (error) {
        errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof HttpStatusError) {
          throw error;
        }
      }
    }

    throw new Error(`Could not reach backend. Tried: ${errors.join(" | ")}`);
  }

  async function prepare(args) {
    const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
    return postJsonWithFallback("/api/review/prepare", {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current
    }, baseCandidates);
  }

  async function generate(args) {
    const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
    return postJsonWithFallback("/api/review/generate", {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current
    }, baseCandidates);
  }

  async function submitTranscriptReviewActionAnalytics(args) {
    const baseCandidates = buildBaseCandidates(args.backendBaseUrl, args.backendBaseUrlFallbacks);
    return postJsonWithFallback("/api/trpc/transcriptions.submitTranscriptReviewAction", {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current,
      inputBoxes: args.inputBoxes || {},
      aiReview: args.aiReview || null,
      metadata: args.metadata || {}
    }, baseCandidates);
  }

  window.BabelReview.backendClient = {
    prepare,
    generate,
    submitTranscriptReviewActionAnalytics
  };
})();
