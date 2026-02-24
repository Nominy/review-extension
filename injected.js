(function () {
  "use strict";

  if (window.__babelReviewInterceptorInstalled) {
    return;
  }
  window.__babelReviewInterceptorInstalled = true;

  const messageSource = "babel-review-interceptor";
  const commandSource = "babel-review-overlay";
  const manualFetchCommandType = "fetch-review-action-data";
  const maxBodyLength = 120000;
  const reviewActionIdRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const defaultTargetNeedles = [
    "claimNextReviewActionFromReviewQueue",
    "getReviewActionDataById",
    "submitTranscriptReviewAction"
  ];
  const claimNeedle = "claimNextReviewActionFromReviewQueue";
  const reviewDataNeedle = "getReviewActionDataById";

  const currentScript = document.currentScript;
  const targetNeedles = parseTargetNeedles(
    currentScript && currentScript.dataset ? currentScript.dataset.targetNeedles : ""
  );
  const autoFetchedActionIds = new Set();

  function parseTargetNeedles(raw) {
    if (!raw) {
      return defaultTargetNeedles;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter((x) => typeof x === "string" && x.trim() !== "");
        return clean.length > 0 ? clean : defaultTargetNeedles;
      }
    } catch (error) {
      // fall through to default
    }
    return defaultTargetNeedles;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clip(text) {
    if (typeof text !== "string") {
      return text;
    }
    if (text.length <= maxBodyLength) {
      return text;
    }
    return `${text.slice(0, maxBodyLength)}\n\n...[truncated ${text.length - maxBodyLength} chars]`;
  }

  function stringifyBody(body) {
    if (body === undefined || body === null) {
      return "";
    }
    if (typeof body === "string") {
      return body;
    }
    if (body instanceof URLSearchParams) {
      return body.toString();
    }
    if (body instanceof FormData) {
      const pairs = [];
      for (const [key, value] of body.entries()) {
        if (typeof value === "string") {
          pairs.push([key, value]);
        } else {
          pairs.push([key, `[blob:${value.type || "application/octet-stream"}:${value.size}]`]);
        }
      }
      return JSON.stringify(pairs);
    }
    if (body instanceof Blob) {
      return `[blob:${body.type || "application/octet-stream"}:${body.size}]`;
    }
    if (body instanceof ArrayBuffer) {
      return `[arrayBuffer:${body.byteLength}]`;
    }
    if (ArrayBuffer.isView(body)) {
      return `[typedArray:${body.byteLength}]`;
    }
    try {
      return JSON.stringify(body);
    } catch (error) {
      return String(body);
    }
  }

  function safeUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function detectEndpoint(url) {
    if (typeof url !== "string") {
      return "";
    }
    for (const needle of targetNeedles) {
      if (url.includes(needle)) {
        return needle;
      }
    }
    return "";
  }

  function isTarget(url) {
    return detectEndpoint(url) !== "";
  }

  function postPayload(payload) {
    window.postMessage(
      {
        source: messageSource,
        type: "review-action-captured",
        payload
      },
      "*"
    );
  }

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
    const stream = parseMaybeJson(normalized);
    if (Array.isArray(stream)) {
      return stream;
    }
    return [];
  }

  function normalizeReviewActionId(value) {
    if (typeof value !== "string") {
      return "";
    }
    return reviewActionIdRegex.test(value) ? value : "";
  }

  function findReviewActionIdByKeyDeep(node) {
    if (!node) {
      return "";
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findReviewActionIdByKeyDeep(item);
        if (found) {
          return found;
        }
      }
      return "";
    }

    if (typeof node === "object") {
      const actionId = normalizeReviewActionId(node.actionId);
      if (actionId) {
        return actionId;
      }

      const reviewActionId = normalizeReviewActionId(node.reviewActionId);
      if (reviewActionId) {
        return reviewActionId;
      }

      const values = Object.values(node);
      for (const value of values) {
        const found = findReviewActionIdByKeyDeep(value);
        if (found) {
          return found;
        }
      }
    }

    return "";
  }

  function extractReviewActionIdFromRequestBody(requestBodyText, endpoint) {
    const parsed = parseMaybeJson(requestBodyText);
    if (!parsed || typeof parsed !== "object") {
      return "";
    }

    if (endpoint === claimNeedle) {
      return "";
    }

    const batched = parsed["0"];
    if (batched && batched.json && typeof batched.json.reviewActionId === "string") {
      const candidate = batched.json.reviewActionId;
      return normalizeReviewActionId(candidate);
    }
    return findReviewActionIdByKeyDeep(parsed);
  }

  function extractReviewActionIdFromResponseText(responseText) {
    const frames = parseTrpcFrameStream(responseText);
    for (const frame of frames) {
      if (frame && typeof frame === "object" && "json" in frame) {
        const inJson = findReviewActionIdByKeyDeep(frame.json);
        if (inJson) {
          return inJson;
        }
      }
      const inFrame = findReviewActionIdByKeyDeep(frame);
      if (inFrame) {
        return inFrame;
      }
    }
    return "";
  }

  const originalFetch = window.fetch;

  async function maybeAutoFetchReviewActionData(
    reviewActionId,
    originEndpoint,
    originUrl,
    force
  ) {
    if (!reviewActionIdRegex.test(reviewActionId)) {
      return;
    }
    if (!force && autoFetchedActionIds.has(reviewActionId)) {
      return;
    }
    autoFetchedActionIds.add(reviewActionId);

    const startedAtMs = Date.now();
    const url = `/api/trpc/transcriptions.getReviewActionDataById?batch=1`;
    const bodyText = JSON.stringify({
      0: {
        json: {
          reviewActionId
        }
      }
    });

    try {
      const response = await originalFetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: bodyText
      });

      let responseBody = "";
      try {
        responseBody = await response.text();
      } catch (error) {
        responseBody = `[unreadable response body: ${error && error.message ? error.message : String(error)}]`;
      }

      postPayload({
        transport: "fetch",
        endpoint: reviewDataNeedle,
        method: "POST",
        url,
        status: response.status,
        ok: response.ok,
        requestBody: clip(bodyText),
        responseBody: clip(responseBody),
        durationMs: Date.now() - startedAtMs,
        capturedAt: nowIso(),
        extractedReviewActionId: reviewActionId,
        autoFetch: true,
        manualTrigger: !!force,
        triggeredByEndpoint: originEndpoint,
        triggeredByUrl: originUrl
      });
    } catch (error) {
      postPayload({
        transport: "fetch",
        endpoint: reviewDataNeedle,
        method: "POST",
        url,
        status: null,
        ok: false,
        requestBody: clip(bodyText),
        responseBody: `[auto fetch error: ${error && error.message ? error.message : String(error)}]`,
        durationMs: Date.now() - startedAtMs,
        capturedAt: nowIso(),
        extractedReviewActionId: reviewActionId,
        autoFetch: true,
        manualTrigger: !!force,
        triggeredByEndpoint: originEndpoint,
        triggeredByUrl: originUrl
      });
    }
  }

  async function readFetchRequestBody(input, init) {
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
      return stringifyBody(init.body);
    }
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch (error) {
        return `[unreadable request body: ${error && error.message ? error.message : String(error)}]`;
      }
    }
    return "";
  }

  function maybeTriggerFollowup(endpoint, reviewActionId, url) {
    if (endpoint === claimNeedle && reviewActionId) {
      void maybeAutoFetchReviewActionData(reviewActionId, endpoint, url, false);
    }
  }

  window.fetch = async function patchedFetch(input, init) {
    const url = safeUrl(input);
    const endpoint = detectEndpoint(url);
    const shouldCapture = endpoint !== "";
    const method =
      (init && init.method) ||
      (input instanceof Request && input.method) ||
      "GET";
    const startedAtMs = Date.now();
    let requestBody = "";

    if (shouldCapture) {
      requestBody = await readFetchRequestBody(input, init);
    }

    try {
      const response = await originalFetch.apply(this, arguments);
      if (shouldCapture) {
        let responseBody = "";
        try {
          responseBody = await response.clone().text();
        } catch (error) {
          responseBody = `[unreadable response body: ${error && error.message ? error.message : String(error)}]`;
        }

        let reviewActionId = "";
        let extractedFrom = "";
        if (endpoint === claimNeedle) {
          reviewActionId = extractReviewActionIdFromResponseText(responseBody);
          extractedFrom = reviewActionId ? "response" : "";
          if (!reviewActionId) {
            reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
            extractedFrom = reviewActionId ? "request" : "";
          }
        } else {
          reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
          extractedFrom = reviewActionId ? "request" : "";
          if (!reviewActionId) {
            reviewActionId = extractReviewActionIdFromResponseText(responseBody);
            extractedFrom = reviewActionId ? "response" : "";
          }
        }

        postPayload({
          transport: "fetch",
          endpoint,
          method,
          url,
          status: response.status,
          ok: response.ok,
          requestBody: clip(requestBody),
          responseBody: clip(responseBody),
          durationMs: Date.now() - startedAtMs,
          capturedAt: nowIso(),
          extractedReviewActionId: reviewActionId || "",
          extractedFrom
        });

        maybeTriggerFollowup(endpoint, reviewActionId, url);
      }
      return response;
    } catch (error) {
      if (shouldCapture) {
        const reviewActionId = extractReviewActionIdFromRequestBody(requestBody, endpoint);
        postPayload({
          transport: "fetch",
          endpoint,
          method,
          url,
          status: null,
          ok: false,
          requestBody: clip(requestBody),
          responseBody: `[fetch error: ${error && error.message ? error.message : String(error)}]`,
          durationMs: Date.now() - startedAtMs,
          capturedAt: nowIso(),
          extractedReviewActionId: reviewActionId || "",
          extractedFrom: reviewActionId ? "request" : ""
        });
      }
      throw error;
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__babelInterceptor = {
      method: method || "GET",
      url: typeof url === "string" ? url : String(url || ""),
      startedAtMs: 0,
      requestBody: ""
    };
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const meta = this.__babelInterceptor || {
      method: "GET",
      url: "",
      startedAtMs: 0,
      requestBody: ""
    };

    meta.startedAtMs = Date.now();
    meta.requestBody = stringifyBody(body);
    this.__babelInterceptor = meta;

    const endpoint = detectEndpoint(meta.url);
    if (endpoint !== "") {
      this.addEventListener("loadend", () => {
        let responseBody = "";
        try {
          if (this.responseType === "" || this.responseType === "text") {
            responseBody = this.responseText || "";
          } else {
            responseBody = `[non-text xhr responseType: ${this.responseType}]`;
          }
        } catch (error) {
          responseBody = `[unreadable xhr response: ${error && error.message ? error.message : String(error)}]`;
        }

        let reviewActionId = "";
        let extractedFrom = "";
        if (endpoint === claimNeedle) {
          reviewActionId = extractReviewActionIdFromResponseText(responseBody);
          extractedFrom = reviewActionId ? "response" : "";
          if (!reviewActionId) {
            reviewActionId = extractReviewActionIdFromRequestBody(meta.requestBody, endpoint);
            extractedFrom = reviewActionId ? "request" : "";
          }
        } else {
          reviewActionId = extractReviewActionIdFromRequestBody(meta.requestBody, endpoint);
          extractedFrom = reviewActionId ? "request" : "";
          if (!reviewActionId) {
            reviewActionId = extractReviewActionIdFromResponseText(responseBody);
            extractedFrom = reviewActionId ? "response" : "";
          }
        }

        postPayload({
          transport: "xhr",
          endpoint,
          method: meta.method,
          url: meta.url,
          status: this.status || null,
          ok: typeof this.status === "number" ? this.status >= 200 && this.status < 300 : false,
          requestBody: clip(meta.requestBody),
          responseBody: clip(responseBody),
          durationMs: Date.now() - meta.startedAtMs,
          capturedAt: nowIso(),
          extractedReviewActionId: reviewActionId || "",
          extractedFrom
        });

        maybeTriggerFollowup(endpoint, reviewActionId, meta.url);
      });
    }

    return originalSend.apply(this, arguments);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== commandSource || data.type !== manualFetchCommandType) {
      return;
    }
    const reviewActionId = normalizeReviewActionId(data.reviewActionId);
    if (!reviewActionId) {
      return;
    }
    void maybeAutoFetchReviewActionData(reviewActionId, "manual", window.location.href, true);
  });
})();
