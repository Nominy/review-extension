(function () {
  "use strict";

  window.BabelReview = window.BabelReview || {};

  function normalizeBaseUrl(value) {
    const raw = (value || "").trim();
    if (!raw) {
      return "";
    }
    return raw.replace(/\/+$/, "");
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
      throw new Error(err);
    }

    if (!data || typeof data !== "object") {
      throw new Error("Backend returned non-JSON payload.");
    }

    return data;
  }

  async function prepare(args) {
    const base = normalizeBaseUrl(args.backendBaseUrl);
    if (!base) {
      throw new Error("Backend URL is required.");
    }
    return postJson(`${base}/api/review/prepare`, {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current
    });
  }

  async function generate(args) {
    const base = normalizeBaseUrl(args.backendBaseUrl);
    if (!base) {
      throw new Error("Backend URL is required.");
    }
    return postJson(`${base}/api/review/generate`, {
      reviewActionId: args.reviewActionId,
      original: args.original,
      current: args.current
    });
  }

  window.BabelReview.backendClient = {
    prepare,
    generate
  };
})();
