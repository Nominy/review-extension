(function () {
  "use strict";

  if (window.__babelReviewMagicInstalled) {
    return;
  }
  window.__babelReviewMagicInstalled = true;

  const BR = window.BabelReview;
  const c = BR.constants;
  const parser = BR.parser;
  const storage = BR.storage;
  const backendClient = BR.backendClient;

  const MAGIC_BUTTON_ID = "babel-review-magic-button";
  const MAGIC_STYLE_ID = "babel-review-magic-style";

  const state = {
    reviewActionId: "",
    original: null,
    current: null,
    lastAiReview: null,
    generating: false,
    waiters: [],
    settings: { ...c.DEFAULT_SETTINGS }
  };
  let persistTimer = null;
  const RATING_PREFIX_BY_CATEGORY = {
    "Word Accuracy": "wordAccuracy",
    "Timestamp Accuracy": "timestampAccuracy",
    "Punctuation & Formatting": "punctuationFormatting",
    "Tags & Emphasis": "tagsEmphasis",
    Segmentation: "segmentation"
  };

  function injectPageInterceptor() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.dataset.targetNeedles = JSON.stringify(c.TARGET_NEEDLES);
    script.async = false;
    (document.documentElement || document.head).appendChild(script);
    script.onload = () => script.remove();
  }

  function getReviewActionIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get("reviewActionId") || "";
      return /^[0-9a-f-]{36}$/i.test(raw) ? raw : "";
    } catch (_) {
      return "";
    }
  }

  function pushToast(message, isError) {
    let holder = document.getElementById("babel-review-magic-toast");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "babel-review-magic-toast";
      holder.style.position = "fixed";
      holder.style.right = "16px";
      holder.style.bottom = "16px";
      holder.style.zIndex = "2147483647";
      holder.style.padding = "10px 12px";
      holder.style.borderRadius = "10px";
      holder.style.font = "600 12px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      holder.style.color = "#fff";
      holder.style.boxShadow = "0 8px 24px rgba(0,0,0,.28)";
      document.documentElement.appendChild(holder);
    }
    holder.textContent = message;
    holder.style.background = isError ? "#b91c1c" : "#166534";
    clearTimeout(holder.__hideTimer);
    holder.__hideTimer = setTimeout(() => holder.remove(), 3000);
  }

  function setButtonState(mode, text) {
    const btn = document.getElementById(MAGIC_BUTTON_ID);
    if (!btn) return;
    btn.dataset.state = mode;
    btn.disabled = mode === "loading";

    const label = btn.querySelector(".babel-review-magic-label");
    if (label) {
      label.textContent = text || "Magic Review";
    }
  }

  function findReviewContainer() {
    const ta = document.querySelector('textarea[placeholder="Provide specific feedback..."]');
    if (!ta) return null;

    let cur = ta.parentElement;
    while (cur && cur !== document.body) {
      const count = cur.querySelectorAll('textarea[placeholder="Provide specific feedback..."]').length;
      if (count >= 5) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function findHeadingIn(container, text) {
    const nodes = container.querySelectorAll("h1,h2,h3,h4,div,span");
    for (const node of nodes) {
      const t = (node.textContent || "").trim();
      if (t === text) return node;
    }
    return null;
  }

  function ensureStyles() {
    if (document.getElementById(MAGIC_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = MAGIC_STYLE_ID;
    style.textContent = `
      #${MAGIC_BUTTON_ID} {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid #c7d2fe;
        background: #eef2ff;
        color: #1f2a44;
        border-radius: 10px;
        padding: 8px 12px;
        font: 600 13px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        cursor: pointer;
      }
      #${MAGIC_BUTTON_ID}:hover { filter: brightness(0.98); }
      #${MAGIC_BUTTON_ID}[data-state="loading"] { opacity: .85; cursor: wait; }
      #${MAGIC_BUTTON_ID}[data-state="done"] { border-color: #86efac; background: #ecfdf3; color: #14532d; }
      #${MAGIC_BUTTON_ID}[data-state="error"] { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
      #${MAGIC_BUTTON_ID} .babel-review-magic-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-right-color: transparent;
        display: none;
      }
      #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-spinner {
        display: inline-block;
        animation: babel-review-spin .8s linear infinite;
      }
      #${MAGIC_BUTTON_ID}[data-state="loading"] .babel-review-magic-icon { display: none; }
      @keyframes babel-review-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureMagicButton() {
    ensureStyles();

    if (document.getElementById(MAGIC_BUTTON_ID)) return;

    const container = findReviewContainer();
    if (!container) return;

    const heading = findHeadingIn(container, "Review the feedback");
    const mount = heading && heading.parentElement ? heading.parentElement : container;

    const btn = document.createElement("button");
    btn.id = MAGIC_BUTTON_ID;
    btn.type = "button";
    btn.dataset.state = "idle";
    btn.innerHTML = `
      <span class="babel-review-magic-icon">🪄</span>
      <span class="babel-review-magic-spinner"></span>
      <span class="babel-review-magic-label">Magic Review</span>
    `;
    btn.addEventListener("click", () => {
      void runMagicReview();
    });

    if (heading && heading.parentElement) {
      heading.parentElement.appendChild(btn);
    } else {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.justifyContent = "flex-end";
      wrap.style.marginBottom = "8px";
      wrap.appendChild(btn);
      container.prepend(wrap);
    }
  }

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function getBackendBaseCandidates() {
    return []
      .concat((state.settings && state.settings.backendBaseUrlFallbacks) || [])
      .concat((c.DEFAULT_SETTINGS && c.DEFAULT_SETTINGS.backendBaseUrlFallbacks) || [])
      .concat([(c.DEFAULT_SETTINGS && c.DEFAULT_SETTINGS.backendBaseUrl) || ""]);
  }

  function findCardByPrefix(root, category) {
    const prefix = RATING_PREFIX_BY_CATEGORY[category];
    if (!prefix) return null;

    const control = root.querySelector(`#${CSS.escape(prefix)}-1`) || document.querySelector(`#${CSS.escape(prefix)}-1`);
    if (!control) return null;

    let card = control.closest("div");
    while (card && card !== root && card !== document.body) {
      if (card.querySelector('textarea[placeholder="Provide specific feedback..."]')) {
        return card;
      }
      card = card.parentElement;
    }
    return null;
  }

  async function applyFeedbackToForm(feedback) {
    const root = findReviewContainer() || document;
    let notesApplied = 0;
    const targets = [];

    for (const item of feedback) {
      if (!item || typeof item !== "object") continue;
      const category = typeof item.category === "string" ? item.category.trim() : "";
      const note = typeof item.note === "string" ? item.note : "";
      if (!category || !note) continue;

      const card = findCardByPrefix(root, category);
      if (!card) continue;
      targets.push({ category, card, note: note.slice(0, 500) });
    }

    for (const target of targets) {
      const textarea = target.card.querySelector('textarea[placeholder="Provide specific feedback..."]');
      if (!textarea) continue;
      setNativeValue(textarea, target.note);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      notesApplied += 1;
    }

    return {
      applied: notesApplied
    };
  }

  function collectInputBoxesSnapshot() {
    const root = findReviewContainer() || document;
    const categories = {};

    for (const category of Object.keys(RATING_PREFIX_BY_CATEGORY)) {
      const card = findCardByPrefix(root, category);
      if (!card) continue;

      const textarea = card.querySelector('textarea[placeholder="Provide specific feedback..."]');
      categories[category] = {
        note: textarea && typeof textarea.value === "string" ? textarea.value : ""
      };
    }

    const notes = Array.from(
      root.querySelectorAll('textarea[placeholder="Provide specific feedback..."]')
    ).map((el, idx) => ({
      index: idx,
      note: typeof el.value === "string" ? el.value : ""
    }));

    return {
      categories,
      notes
    };
  }

  async function submitTranscriptReviewActionAnalytics(entry) {
    if (!entry || entry.endpoint !== "submitTranscriptReviewAction") {
      return;
    }

    const actionId =
      (typeof entry.extractedReviewActionId === "string" && entry.extractedReviewActionId) ||
      state.reviewActionId ||
      getReviewActionIdFromUrl();
    if (!actionId || !state.original) {
      return;
    }

    const current = state.current || state.original;
    const inputBoxes = collectInputBoxesSnapshot();

    try {
      await backendClient.submitTranscriptReviewActionAnalytics({
        backendBaseUrl: (state.settings.backendBaseUrl || c.DEFAULT_SETTINGS.backendBaseUrl).trim(),
        backendBaseUrlFallbacks: getBackendBaseCandidates(),
        reviewActionId: actionId,
        original: state.original,
        current,
        inputBoxes,
        aiReview: state.lastAiReview,
        metadata: {
          source: "review-interceptor-extension",
          capturedAt: new Date().toISOString(),
          trpcStatus: entry.status,
          trpcOk: entry.ok,
          trpcUrl: entry.url || "",
          trpcMethod: entry.method || "",
          trpcDurationMs: entry.durationMs
        }
      });
    } catch (error) {
      console.warn(
        `[babel-review] failed to submit submitTranscriptReviewAction analytics: ${
          error && error.message ? error.message : String(error)
        }`
      );
    }
  }

  function resolveWaiters(actionId) {
    const pending = [];
    for (const waiter of state.waiters) {
      if (waiter.actionId === actionId) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }
    state.waiters = pending;
  }

  function waitForCapture(actionId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        state.waiters = state.waiters.filter((w) => w.timer !== timer);
        reject(new Error("Timed out while refreshing latest review data."));
      }, timeoutMs);
      state.waiters.push({ actionId, resolve, reject, timer });
    });
  }

  function handleCapturedEntry(entry) {
    if (entry && entry.endpoint === "submitTranscriptReviewAction") {
      void submitTranscriptReviewActionAnalytics(entry);
    }

    const normalized = parser.extractNormalizedFromEntry(entry);
    if (!normalized) {
      return;
    }
    const actionId = normalized.actionId || entry.extractedReviewActionId || "";
    if (!actionId) {
      return;
    }

    if (state.reviewActionId && state.reviewActionId !== actionId) {
      state.reviewActionId = actionId;
      state.original = normalized;
      state.current = normalized;
    } else {
      state.reviewActionId = actionId;
      if (!state.original) {
        state.original = normalized;
      }
      state.current = normalized;
    }
    schedulePersist();
    resolveWaiters(actionId);
  }

  function schedulePersist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistBaseline();
    }, 220);
  }

  async function persistBaseline() {
    if (!state.reviewActionId || !state.original) {
      return;
    }
    const current = state.current || state.original;
    const session = {
      reviewActionId: state.reviewActionId,
      original: state.original,
      current,
      originalCapturedAt: state.original.capturedAt || "",
      currentCapturedAt: current.capturedAt || ""
    };
    await storage.saveState({
      sessions: { [state.reviewActionId]: session },
      settings: state.settings,
      selectedSessionId: state.reviewActionId
    });
  }

  async function refreshLatestCurrent(actionId) {
    const timeoutMs = Number(c.DEFAULT_SETTINGS.refreshTimeoutMs || 9000);
    const waiter = waitForCapture(actionId, timeoutMs);
    window.postMessage(
      {
        source: c.COMMAND_SOURCE,
        type: c.COMMAND_FETCH_REVIEW_ACTION,
        reviewActionId: actionId
      },
      "*"
    );
    await waiter;
  }

  async function runMagicReview() {
    if (state.generating) {
      return;
    }

    const actionId = state.reviewActionId || getReviewActionIdFromUrl();
    if (!actionId) {
      pushToast("Could not detect reviewActionId.", true);
      return;
    }

    state.generating = true;
    setButtonState("loading", "Generating...");
    try {
      await refreshLatestCurrent(actionId);

      if (!state.original || !state.current) {
        throw new Error("No ORIGINAL/CURRENT state captured yet.");
      }

      const result = await backendClient.generate({
        backendBaseUrl: (state.settings.backendBaseUrl || c.DEFAULT_SETTINGS.backendBaseUrl).trim(),
        backendBaseUrlFallbacks: getBackendBaseCandidates(),
        reviewActionId: actionId,
        original: state.original,
        current: state.current
      });
      state.lastAiReview = result && result.llm ? result.llm : null;

      const feedback =
        result && result.llm && Array.isArray(result.llm.feedback) ? result.llm.feedback : [];
      if (!feedback.length) {
        throw new Error("Backend returned empty feedback.");
      }

      const resultApply = await applyFeedbackToForm(feedback);
      if (!resultApply.applied) {
        throw new Error("Could not find review form fields to apply feedback.");
      }

      setButtonState("done", `Applied (${resultApply.applied})`);
      pushToast(`Applied feedback to ${resultApply.applied} categories.`, false);
      setTimeout(() => setButtonState("idle", "Magic Review"), 1600);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      setButtonState("error", "Retry");
      pushToast(`Magic Review failed: ${msg}`, true);
    } finally {
      state.generating = false;
    }
  }

  function bootstrap() {
    injectPageInterceptor();

    void (async () => {
      try {
        const loaded = await storage.loadState();
        state.settings = { ...c.DEFAULT_SETTINGS, ...(loaded.settings || {}) };
        const ids = Object.keys(loaded.sessions || {});
        if (!ids.length) return;
        const pick =
          (loaded.selectedSessionId && loaded.sessions[loaded.selectedSessionId] && loaded.selectedSessionId) ||
          ids[0];
        const session = loaded.sessions[pick];
        if (!session) return;
        state.reviewActionId = session.reviewActionId || pick;
        state.original = session.original || null;
        state.current = session.current || session.original || null;
      } catch (_) {
        // Ignore storage load failures; runtime capture will rebuild state.
      }
    })();

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== c.EVENT_SOURCE || data.type !== "review-action-captured") return;
      if (!data.payload || typeof data.payload !== "object") return;
      handleCapturedEntry(data.payload);
      ensureMagicButton();
    });

    const observer = new MutationObserver(() => {
      ensureMagicButton();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ensureMagicButton();
  }

  bootstrap();
})();
