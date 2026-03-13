import { DEFAULT_SETTINGS } from './constants';
import {
  createReviewSession,
  decideReviewSessionSuggestion,
  finalizeReviewSession,
  generate,
  generateReviewSessionSuggestions,
  saveReviewSessionComments,
  submitTranscriptReviewActionAnalytics
} from './backend-client';
import { loadState, saveState } from './storage';
import type {
  BabelDiffPayload,
  CapturedNetworkEntry,
  GeneratedReviewResponse,
  NormalizedReviewAction,
  ReviewKernel,
  ReviewSessionData
} from './types';
import { extractNormalizedFromEntry } from '../parsers/review-action-parser';
import { createPageBridgeService } from '../services/page-bridge-service';
import { createReviewDialogService } from '../services/review-dialog-service';
import { createReviewFormService } from '../services/review-form-service';

interface CaptureWaiter {
  actionId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}

interface DiffWaiter {
  actionId: string;
  resolve: (payload: BabelDiffPayload) => void;
  reject: (error: Error) => void;
  timer: number;
}

function getReviewActionIdFromUrl(): string {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('reviewActionId') || '';
    return /^[0-9a-f-]{36}$/i.test(raw) ? raw : '';
  } catch {
    return '';
  }
}

function cloneComments(session: ReviewSessionData | null): {
  sessionComment: string;
  cardComments: Record<string, string>;
} {
  return {
    sessionComment: session?.comments?.sessionComment || '',
    cardComments: { ...(session?.comments?.cardComments || {}) }
  };
}

export function createReviewKernel(): ReviewKernel {
  const bridge = createPageBridgeService();
  const form = createReviewFormService();
  const dialog = createReviewDialogService();

  const state = {
    reviewActionId: '',
    original: null as NormalizedReviewAction | null,
    current: null as NormalizedReviewAction | null,
    lastAiReview: null as GeneratedReviewResponse['llm'] | null,
    lastTranscriptionDiff: null as BabelDiffPayload | null,
    activeSession: null as ReviewSessionData | null,
    generating: false,
    settings: { ...DEFAULT_SETTINGS },
    waiters: [] as CaptureWaiter[],
    diffWaiters: [] as DiffWaiter[]
  };

  let persistTimer = 0;
  let commentSaveTimer = 0;
  let commentRevision = 0;
  let savedCommentRevision = 0;
  let commentSaveChain: Promise<void> = Promise.resolve();

  function getBackendBaseCandidates(): string[] {
    return Array.from(
      new Set([
        ...(state.settings.backendBaseUrlFallbacks || []),
        ...(DEFAULT_SETTINGS.backendBaseUrlFallbacks || []),
        state.settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl
      ].filter(Boolean))
    );
  }

  function schedulePersist(): void {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      void persistBaseline();
    }, 220);
  }

  async function persistBaseline(): Promise<void> {
    if (!state.reviewActionId || !state.original) {
      return;
    }

    const current = state.current || state.original;
    await saveState({
      sessions: {
        [state.reviewActionId]: {
          reviewActionId: state.reviewActionId,
          original: state.original,
          current,
          originalCapturedAt: state.original.capturedAt,
          currentCapturedAt: current.capturedAt
        }
      },
      settings: state.settings,
      selectedSessionId: state.reviewActionId
    });
  }

  function resolveCaptureWaiters(actionId: string): void {
    const pending: CaptureWaiter[] = [];
    for (const waiter of state.waiters) {
      if (waiter.actionId === actionId) {
        window.clearTimeout(waiter.timer);
        waiter.resolve();
      } else {
        pending.push(waiter);
      }
    }
    state.waiters = pending;
  }

  function resolveDiffWaiters(actionId: string, payload: BabelDiffPayload | null, error?: Error): void {
    const pending: DiffWaiter[] = [];
    for (const waiter of state.diffWaiters) {
      if (waiter.actionId === actionId) {
        window.clearTimeout(waiter.timer);
        if (error || !payload) {
          waiter.reject(error || new Error('Babel diff fetch returned empty payload.'));
        } else {
          waiter.resolve(payload);
        }
      } else {
        pending.push(waiter);
      }
    }
    state.diffWaiters = pending;
  }

  function waitForCapture(actionId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        state.waiters = state.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error('Timed out while refreshing latest review data.'));
      }, timeoutMs);

      state.waiters.push({ actionId, resolve, reject, timer });
    });
  }

  function waitForDiff(actionId: string, timeoutMs: number): Promise<BabelDiffPayload> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        state.diffWaiters = state.diffWaiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error('Timed out while fetching Babel transcription diff.'));
      }, timeoutMs);

      state.diffWaiters.push({ actionId, resolve, reject, timer });
    });
  }

  function handleCapturedEntry(entry: CapturedNetworkEntry): void {
    if (entry.endpoint === 'submitTranscriptReviewAction') {
      void submitAnalytics(entry);
    }

    const normalized = extractNormalizedFromEntry(entry);
    if (!normalized) {
      return;
    }

    const actionId = normalized.actionId || entry.extractedReviewActionId || '';
    if (!actionId) {
      return;
    }

    if (state.reviewActionId && state.reviewActionId !== actionId) {
      state.reviewActionId = actionId;
      state.original = normalized;
      state.current = normalized;
      state.lastTranscriptionDiff = null;
      state.activeSession = null;
    } else {
      state.reviewActionId = actionId;
      if (!state.original) {
        state.original = normalized;
      }
      state.current = normalized;
    }

    schedulePersist();
    resolveCaptureWaiters(actionId);
  }

  async function refreshLatestCurrent(actionId: string): Promise<void> {
    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    const waiter = waitForCapture(actionId, timeout);
    bridge.fetchReviewAction(actionId);
    await waiter;
  }

  function getCurrentTranscriptionChunkId(): string {
    const current = state.current || state.original;
    const recordings = current?.recordings || [];
    for (const recording of recordings) {
      if (recording.transcriptionChunkId) {
        return recording.transcriptionChunkId;
      }
    }
    return '';
  }

  async function ensureLatestTranscriptionDiff(actionId: string): Promise<BabelDiffPayload> {
    const existing = state.lastTranscriptionDiff;
    if (existing?.ok && existing.currentReviewActionId === actionId) {
      return existing;
    }

    const transcriptionChunkId = getCurrentTranscriptionChunkId();
    if (!transcriptionChunkId) {
      throw new Error('Could not detect transcriptionChunkId from captured review action data.');
    }

    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    const waiter = waitForDiff(actionId, timeout);
    bridge.fetchTranscriptionDiff({ reviewActionId: actionId, transcriptionChunkId });
    return waiter;
  }

  async function submitAnalytics(entry: CapturedNetworkEntry): Promise<void> {
    const actionId = entry.extractedReviewActionId || state.reviewActionId || getReviewActionIdFromUrl();
    if (!actionId || !state.original) {
      return;
    }

    const current = state.current || state.original;
    const inputBoxes = form.collectInputBoxesSnapshot();

    try {
      if (!state.lastTranscriptionDiff || state.lastTranscriptionDiff.currentReviewActionId !== actionId) {
        try {
          await refreshLatestCurrent(actionId);
          await ensureLatestTranscriptionDiff(actionId);
        } catch (error) {
          console.warn(
            `[babel-review] failed to fetch Babel diff before analytics submit: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      await submitTranscriptReviewActionAnalytics({
        backendBaseUrl: state.settings.backendBaseUrl.trim(),
        backendBaseUrlFallbacks: getBackendBaseCandidates(),
        reviewActionId: actionId,
        original: state.original,
        current,
        babelDiff: state.lastTranscriptionDiff,
        inputBoxes,
        aiReview: state.lastAiReview,
        metadata: {
          source: 'review-interceptor-extension',
          capturedAt: new Date().toISOString(),
          trpcStatus: entry.status,
          trpcOk: entry.ok,
          trpcUrl: entry.url || '',
          trpcMethod: entry.method || '',
          trpcDurationMs: entry.durationMs,
          workflowMode: state.settings.workflowMode
        }
      });
    } catch (error) {
      console.warn(
        `[babel-review] failed to submit submitTranscriptReviewAction analytics: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  function updateLocalCardComment(cardId: string, value: string): void {
    if (!state.activeSession) {
      return;
    }

    if (!state.activeSession.comments) {
      state.activeSession.comments = { sessionComment: '', cardComments: {} };
    }

    if (value.trim()) {
      state.activeSession.comments.cardComments[cardId] = value;
    } else {
      delete state.activeSession.comments.cardComments[cardId];
    }

    commentRevision += 1;
    scheduleCommentSave();
  }

  function updateLocalSessionComment(value: string): void {
    if (!state.activeSession) {
      return;
    }

    if (!state.activeSession.comments) {
      state.activeSession.comments = { sessionComment: '', cardComments: {} };
    }

    state.activeSession.comments.sessionComment = value;
    commentRevision += 1;
    scheduleCommentSave();
  }

  function scheduleCommentSave(): void {
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = window.setTimeout(() => {
      commentSaveTimer = 0;
      void saveSessionCommentsNow();
    }, 500);
  }

  async function saveSessionCommentsNow(): Promise<void> {
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = 0;

    const session = state.activeSession;
    if (!session || commentRevision === savedCommentRevision) {
      return;
    }

    const targetRevision = commentRevision;
    const sessionId = session.sessionId;
    const comments = cloneComments(session);

    commentSaveChain = commentSaveChain
      .catch(() => undefined)
      .then(async () => {
        const result = await saveReviewSessionComments({
          backendBaseUrl: state.settings.backendBaseUrl.trim(),
          backendBaseUrlFallbacks: getBackendBaseCandidates(),
          sessionId,
          sessionComment: comments.sessionComment,
          cardComments: comments.cardComments
        });

        if (!state.activeSession || state.activeSession.sessionId !== sessionId) {
          return;
        }

        savedCommentRevision = Math.max(savedCommentRevision, targetRevision);
        if (targetRevision === commentRevision) {
          state.activeSession = result;
        } else {
          state.activeSession = {
            ...result,
            comments: cloneComments(state.activeSession)
          };
        }
      });

    try {
      await commentSaveChain;
    } catch (error) {
      console.warn(
        `[babel-review] failed to save session comments: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  function requireActionId(): string {
    const actionId = state.reviewActionId || getReviewActionIdFromUrl();
    if (!actionId) {
      throw new Error('Could not detect reviewActionId.');
    }
    return actionId;
  }

  function requireBaseline(): { actionId: string; original: NormalizedReviewAction; current: NormalizedReviewAction } {
    const actionId = requireActionId();
    if (!state.original || !state.current) {
      throw new Error('No ORIGINAL/CURRENT state captured yet.');
    }
    return {
      actionId,
      original: state.original,
      current: state.current
    };
  }

  async function createInteractiveSession(actionId: string): Promise<ReviewSessionData> {
    const result = await createReviewSession({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      reviewActionId: actionId,
      original: state.original as NormalizedReviewAction,
      current: state.current as NormalizedReviewAction,
      babelDiff: state.lastTranscriptionDiff
    });

    state.activeSession = result;
    commentRevision = 0;
    savedCommentRevision = 0;
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = 0;
    return result;
  }

  async function runFastMagicReview(actionId: string): Promise<void> {
    const result = await generate({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      reviewActionId: actionId,
      original: state.original as NormalizedReviewAction,
      current: state.current as NormalizedReviewAction,
      babelDiff: state.lastTranscriptionDiff
    });

    state.lastAiReview = result?.llm || null;
    const feedback = Array.isArray(result?.llm?.feedback) ? result.llm.feedback : [];
    if (!feedback.length) {
      throw new Error('Backend returned empty feedback.');
    }

    const applied = await form.applyFeedback(feedback);
    if (!applied.applied) {
      throw new Error('Could not find review form fields to apply feedback.');
    }

    form.setState('done', `Applied (${applied.applied})`);
    form.pushToast(`Applied feedback to ${applied.applied} categories.`, false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1600);
  }

  async function runInteractiveMagicReview(actionId: string): Promise<void> {
    dialog.openLoading('Preparing review session...');

    const result = await createInteractiveSession(actionId);
    dialog.renderSession(result, 'Expand a change to inspect the system opinion.');
    form.setState('done', 'Review Open');
    form.pushToast('Opened interactive review dialog.', false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1200);
  }

  async function refreshInteractiveSession(): Promise<void> {
    const { actionId } = requireBaseline();
    dialog.setBusy(true, 'Refreshing analysis...');

    await refreshLatestCurrent(actionId);
    try {
      await ensureLatestTranscriptionDiff(actionId);
    } catch (error) {
      console.warn(
        `[babel-review] failed to refresh Babel diff: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const session = await createInteractiveSession(actionId);
    dialog.renderSession(session, 'Refreshed with the latest review state.');
  }

  async function generateSuggestionsForSession(): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveSessionCommentsNow();
    dialog.setBusy(true, 'Generating template suggestions...');
    const session = await generateReviewSessionSuggestions({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      sessionId
    });
    state.activeSession = session;
    dialog.renderSession(session, session.suggestions?.length ? 'Suggestions ready for review.' : 'No suggestions were generated.');
  }

  async function decideSuggestion(proposalId: string, decision: 'approved' | 'rejected'): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    dialog.setBusy(true, decision === 'approved' ? 'Approving suggestion...' : 'Rejecting suggestion...');
    const session = await decideReviewSessionSuggestion({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      sessionId,
      proposalId,
      decision
    });
    state.activeSession = session;
    dialog.renderSession(session, decision === 'approved' ? 'Suggestion approved.' : 'Suggestion rejected.');
  }

  async function finalizeInteractiveSession(mode: 'apply' | 'skip'): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveSessionCommentsNow();
    dialog.setBusy(true, mode === 'apply' ? 'Applying final review...' : 'Applying immediate review...');
    const result = await finalizeReviewSession({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      sessionId,
      mode
    });

    const feedback = Array.isArray(result.categoryFeedback) ? result.categoryFeedback : [];
    if (!feedback.length) {
      throw new Error('Interactive review returned empty feedback.');
    }

    const applied = await form.applyFeedback(feedback);
    state.lastAiReview = result.aiReview || { feedback };

    if (!applied.applied) {
      throw new Error('Interactive review could not find review form fields.');
    }

    state.activeSession = null;
    dialog.close();
    form.setState('done', `Applied (${applied.applied})`);
    form.pushToast(`Applied feedback to ${applied.applied} categories.`, false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1600);
  }

  async function runMagicReview(): Promise<void> {
    if (state.generating) {
      return;
    }

    const actionId = state.reviewActionId || getReviewActionIdFromUrl();
    if (!actionId) {
      form.pushToast('Could not detect reviewActionId.', true);
      return;
    }

    state.generating = true;
    form.setState('loading', state.settings.workflowMode === 'interactive' ? 'Opening...' : 'Generating...');

    try {
      await refreshLatestCurrent(actionId);

      try {
        await ensureLatestTranscriptionDiff(actionId);
      } catch (error) {
        console.warn(
          `[babel-review] failed to fetch Babel diff before generation: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      requireBaseline();

      if (state.settings.workflowMode === 'interactive') {
        await runInteractiveMagicReview(actionId);
      } else {
        await runFastMagicReview(actionId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dialog.isOpen()) {
        dialog.setStatus(`Magic Review failed: ${message}`, true);
      }
      form.setState('error', 'Retry');
      form.pushToast(`Magic Review failed: ${message}`, true);
    } finally {
      state.generating = false;
    }
  }

  function installDialog(): void {
    dialog.mount({
      onClose: () => {
        void saveSessionCommentsNow();
        dialog.close();
        form.setState('idle', 'Magic Review');
      },
      onRefresh: async () => {
        try {
          await refreshInteractiveSession();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Refresh failed: ${message}`, true);
        }
      },
      onGenerateSuggestions: async () => {
        try {
          await generateSuggestionsForSession();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Suggestion generation failed: ${message}`, true);
        }
      },
      onFinalize: async (mode) => {
        try {
          await finalizeInteractiveSession(mode);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Apply failed: ${message}`, true);
        }
      },
      onCardCommentChange: (cardId, value) => {
        updateLocalCardComment(cardId, value);
      },
      onSessionCommentChange: (value) => {
        updateLocalSessionComment(value);
      },
      onSuggestionDecision: async (proposalId, decision) => {
        try {
          await decideSuggestion(proposalId, decision);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Suggestion update failed: ${message}`, true);
        }
      }
    });
  }

  return {
    async start(): Promise<void> {
      bridge.inject();
      installDialog();

      try {
        const stored = await loadState();
        state.settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
        const ids = Object.keys(stored.sessions || {});
        if (ids.length) {
          const pick =
            (stored.selectedSessionId && stored.sessions[stored.selectedSessionId] && stored.selectedSessionId) ||
            ids[0];
          const session = stored.sessions[pick];
          if (session) {
            state.reviewActionId = session.reviewActionId || pick;
            state.original = session.original || null;
            state.current = session.current || session.original || null;
          }
        }
      } catch {
        // Ignore storage failures; runtime capture will rebuild state.
      }

      bridge.onReviewActionCaptured(handleCapturedEntry);
      bridge.onTranscriptionDiff((payload) => {
        const actionId = payload.currentReviewActionId || state.reviewActionId || getReviewActionIdFromUrl();
        if (!actionId) {
          return;
        }

        if (!payload.ok) {
          resolveDiffWaiters(actionId, null, new Error(payload.error || 'Babel diff fetch failed.'));
          return;
        }

        state.lastTranscriptionDiff = payload;
        resolveDiffWaiters(actionId, payload);
      });

      form.ensure(() => runMagicReview());
    },
    ensureMagicButton(): void {
      form.ensure(() => runMagicReview());
    }
  };
}
