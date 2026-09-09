import { gradingSnapshotKey } from '@nominy/babel-babel-runtime';
import { DEFAULT_SETTINGS, RUNTIME_POLICY, sanitizeSettings } from './runtime-config';
import {
  createReviewSession,
  decideReviewSessionSuggestion,
  finalizeReviewSession,
  generate,
  generateReviewSessionSuggestions,
  searchReviewTemplates,
  clearReviewSessionCardTemplateMatch,
  saveReviewSessionComments,
  submitTranscriptReviewActionAnalytics,
  updateReviewSessionCardTemplateMatch
} from './backend-client';
import { loadState, saveState } from './storage';
import type {
  BabelDiffPayload,
  CapturedNetworkEntry,
  GeneratedReviewResponse,
  GraderAddon,
  GradingSnapshot,
  NormalizedReviewAction,
  ReviewKernel,
  ReviewSessionData,
  TemplateSearchResult
} from './types';
import { extractNormalizedFromEntry } from '../parsers/review-action-parser';
import { createPageBridgeService } from '../services/page-bridge-service';
import { createReviewDialogService } from '../services/review-dialog-service';
import { createReviewFormService } from '../services/review-form-service';

interface CaptureWaiter {
  actionId: string;
  accept?: (action: NormalizedReviewAction, entry: CapturedNetworkEntry) => boolean;
  resolve: (actionId: string) => void;
  reject: (error: Error) => void;
  timer: number;
}

interface DiffWaiter {
  actionId: string;
  resolve: (payload: BabelDiffPayload) => void;
  reject: (error: Error) => void;
  timer: number;
}
type PendingBaselineFetch = {
  currentActionId: string;
  referenceActionId: string;
};

function isReviewActionId(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function getReviewActionIdFromUrl(): string {
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('reviewActionId') || '';
    return isReviewActionId(raw) ? raw : '';
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

interface ReviewRun {
  id: string;
  revision: number;
  route: string;
  snapshot: GradingSnapshot;
  key: string;
  ready: Promise<void>;
  addonAvailable: boolean;
  error: Error | null;
}

export function createReviewKernel(grader?: GraderAddon): ReviewKernel {
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
    diffWaiters: [] as DiffWaiter[],
    pendingBaselineFetch: null as PendingBaselineFetch | null
  };

  let commentSaveTimer = 0;
  let reviewRevision = 0;
  let activeRun: ReviewRun | null = null;
  let reviewRoute = window.location.href;
  let commentRevision = 0;
  let savedCommentRevision = 0;
  let commentSaveChain: Promise<void> = Promise.resolve();
  const templateSearchTimers = new Map<string, number>();
  const templateSearchRevisions = new Map<string, number>();

  function getBackendBaseCandidates(): string[] {
    const settings = sanitizeSettings(state.settings);
    return Array.from(
      new Set([settings.backendBaseUrl, ...settings.backendBaseUrlFallbacks, ...DEFAULT_SETTINGS.backendBaseUrlFallbacks].filter(Boolean))
    );
  }

  function cancelReviewRun(): void {
    reviewRevision += 1;
    const run = activeRun;
    activeRun = null;
    if (run?.addonAvailable) grader?.cancel(run.id);
    if (run?.addonAvailable) form.setGradingStatus('Grading cancelled — run Magic Review again');
  }

  function checkRoute(): void {
    if (reviewRoute !== window.location.href) {
      reviewRoute = window.location.href;
      cancelReviewRun();
      updateActiveSession(null);
      dialog.close();
    }
  }

  function assertRun(run: ReviewRun): void {
    if (activeRun !== run || run.revision !== reviewRevision || run.route !== window.location.href
      || getLiveReviewActionId() !== run.snapshot.reviewActionId
      || !state.original || !state.current
      || gradingSnapshotKey(state.original, state.current) !== run.key) {
      throw new Error('The review changed. Refresh Magic Review before applying.');
    }
  }

  function beginReviewRun(actionId: string, revision: number, route: string): ReviewRun {
    const pair = requireBaseline();
    if (revision !== reviewRevision || route !== window.location.href
      || pair.actionId !== actionId || pair.current.actionId !== actionId) {
      throw new Error('The review changed. Run Magic Review again.');
    }
    const snapshot = { reviewActionId: actionId, original: structuredClone(pair.original), current: structuredClone(pair.current) };
    const run: ReviewRun = {
      id: `review-${Date.now()}-${revision}`, revision, route, snapshot,
      key: gradingSnapshotKey(snapshot.original, snapshot.current),
      ready: Promise.resolve(), addonAvailable: false, error: null
    };
    activeRun = run;
    if (grader) {
      form.setGradingStatus('Checking grading…');
      run.ready = (async () => {
        run.addonAvailable = await grader.available();
        assertRun(run);
        if (!run.addonAvailable) {
          form.setGradingStatus('Grading unavailable — comments only', true);
          return;
        }
        form.setGradingStatus('Generating grades…');
        await grader.prepare(run.id, snapshot);
        assertRun(run);
        form.setGradingStatus('Grades ready to apply');
      })().catch(error => {
        run.error = error instanceof Error ? error : new Error(String(error));
        if (activeRun === run && run.revision === reviewRevision && run.route === window.location.href) {
          form.setGradingStatus('Grading failed — retry Magic Review', true);
          if (dialog.isOpen()) dialog.setStatus(`Review Grader failed: ${run.error.message}`, true);
          form.setState('error', 'Retry');
          form.pushToast(`Review Grader failed: ${run.error.message}`, true);
        }
      });
    }
    return run;
  }

  async function prepareApplication(run: ReviewRun): Promise<GradingSnapshot> {
    assertRun(run);
    await run.ready;
    assertRun(run);
    if (run.error) throw run.error;
    if (!getReviewActionIdFromUrl()) {
      const captured = waitForCapture('', Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs),
        action => Number(action.actionLevel) !== 1);
      bridge.fetchCurrentReviewAction();
      await captured;
      assertRun(run);
    }
    await refreshLatestCurrent(run.snapshot.reviewActionId);
    await refreshStableOriginal(run.snapshot.reviewActionId);
    assertRun(run);
    return {
      reviewActionId: run.snapshot.reviewActionId,
      original: structuredClone(state.original as NormalizedReviewAction),
      current: structuredClone(state.current as NormalizedReviewAction)
    };
  }

  async function applyPreparedGrades(run: ReviewRun, snapshot: GradingSnapshot): Promise<void> {
    assertRun(run);
    if (run.addonAvailable) {
      form.setGradingStatus('Applying grades…');
      try {
        await grader?.apply(run.id, snapshot);
        assertRun(run);
        form.setGradingStatus('Grades applied');
      } catch (error) {
        if (activeRun === run) form.setGradingStatus('Grades not applied — retry Magic Review', true);
        throw error;
      }
    }
    assertRun(run);
  }

  function resetReviewSnapshot(): void {
    state.reviewActionId = '';
    state.original = null;
    state.current = null;
    state.lastAiReview = null;
    state.lastTranscriptionDiff = null;
    state.pendingBaselineFetch = null;
    updateActiveSession(null);
  }

  function resolveCaptureWaiters(
    actionId: string,
    action: NormalizedReviewAction,
    entry: CapturedNetworkEntry
  ): void {
    const pending: CaptureWaiter[] = [];
    for (const waiter of state.waiters) {
      const actionMatches = !waiter.actionId || waiter.actionId === actionId;
      const accepted = !waiter.accept || waiter.accept(action, entry);
      if (actionMatches && accepted) {
        window.clearTimeout(waiter.timer);
        waiter.resolve(actionId);
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

  function waitForCapture(
    actionId: string,
    timeoutMs: number,
    accept?: (action: NormalizedReviewAction, entry: CapturedNetworkEntry) => boolean
  ): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const timer = window.setTimeout(() => {
      state.waiters = state.waiters.filter((waiter) => waiter.timer !== timer);
      reject(new Error('Timed out while refreshing latest review data.'));
    }, timeoutMs);

    state.waiters.push({ actionId, accept, resolve, reject, timer });
    return promise;
  }

  function getLiveReviewActionId(): string {
    const urlActionId = getReviewActionIdFromUrl();
    if (urlActionId) {
      return urlActionId;
    }
    if (Number(state.current?.actionLevel) === 1) {
      return '';
    }
    return state.reviewActionId;
  }

  function waitForDiff(actionId: string, timeoutMs: number): Promise<BabelDiffPayload> {
    const { promise, resolve, reject } = Promise.withResolvers<BabelDiffPayload>();
    const timer = window.setTimeout(() => {
      state.diffWaiters = state.diffWaiters.filter((waiter) => waiter.timer !== timer);
      reject(new Error('Timed out while fetching Babel transcription diff.'));
    }, timeoutMs);

    state.diffWaiters.push({ actionId, resolve, reject, timer });
    return promise;
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

    const pendingBaseline = state.pendingBaselineFetch;
    if (pendingBaseline?.referenceActionId === actionId) {
      if (!state.reviewActionId || state.reviewActionId === pendingBaseline.currentActionId) {
        state.reviewActionId = pendingBaseline.currentActionId;
        state.original = normalized;
      }
      resolveCaptureWaiters(actionId, normalized, entry);
      return;
    }

    const stableOriginal = Number(normalized.actionLevel) === 1;
    if (
      stableOriginal &&
      state.current &&
      state.current.actionId !== actionId &&
      Number(state.current.actionLevel) !== 1
    ) {
      state.original = normalized;
      resolveCaptureWaiters(actionId, normalized, entry);
      return;
    }

    if (state.reviewActionId && state.reviewActionId !== actionId) {
      cancelReviewRun();
      state.reviewActionId = actionId;
      state.original = stableOriginal ? normalized : null;
      state.current = normalized;
      state.lastTranscriptionDiff = null;
      updateActiveSession(null);
    } else {
      state.reviewActionId = actionId;
      if (stableOriginal) {
        state.original = normalized;
      } else if (!state.original || state.original.actionId === actionId) {
        state.original = null;
      }
      state.current = normalized;
      state.lastTranscriptionDiff = null;
    }

    resolveCaptureWaiters(actionId, normalized, entry);
  }

  async function refreshLatestCurrent(actionId: string): Promise<void> {
    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    const waiter = waitForCapture(actionId, timeout);
    bridge.fetchReviewAction(actionId);
    await waiter;
  }

  async function ensureCurrentReviewActionId(): Promise<string> {
    let actionId = getLiveReviewActionId();
    if (actionId) {
      return actionId;
    }

    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    const capturedActionId = waitForCapture(
      '',
      timeout,
      (action) => Number(action.actionLevel) !== 1
    );
    bridge.fetchCurrentReviewAction();
    actionId = getLiveReviewActionId() || (await capturedActionId);
    if (!actionId) {
      throw new Error('Could not detect current reviewActionId from the Babel page context.');
    }
    return actionId;
  }

  async function ensureLatestTranscriptionDiff(actionId: string): Promise<BabelDiffPayload> {
    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    const waiter = waitForDiff(actionId, timeout);
    bridge.fetchTranscriptionDiff({ reviewActionId: actionId });
    return waiter;
  }

  async function refreshStableOriginal(actionId: string): Promise<void> {
    if (state.current?.actionId === actionId && Number(state.current.actionLevel) === 1) {
      state.original = state.current;
      return;
    }

    const diff = await ensureLatestTranscriptionDiff(actionId);
    const referenceActionId = typeof diff.referenceReviewActionId === 'string' ? diff.referenceReviewActionId : '';
    if (!isReviewActionId(referenceActionId) || referenceActionId === actionId) {
      throw new Error('Could not detect stable original review action for this transcription.');
    }


    const timeout = Number(state.settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
    state.pendingBaselineFetch = { currentActionId: actionId, referenceActionId };
    const waiter = waitForCapture(referenceActionId, timeout);
    bridge.fetchReviewAction(referenceActionId);
    try {
      await waiter;
    } finally {
      if (state.pendingBaselineFetch?.referenceActionId === referenceActionId) {
        state.pendingBaselineFetch = null;
      }
    }

    if (state.original?.actionId !== referenceActionId) {
      throw new Error('Stable original review action was fetched but could not be normalized.');
    }
  }

  async function submitAnalytics(entry: CapturedNetworkEntry): Promise<void> {
    if (!RUNTIME_POLICY.enableSubmitAnalytics) {
      return;
    }

    const actionId = entry.extractedReviewActionId || state.reviewActionId || getReviewActionIdFromUrl();
    if (!actionId || !state.original) {
      return;
    }

    const current = state.current || state.original;
    const inputBoxes = form.collectInputBoxesSnapshot();

    try {
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
          source: 'review-helper-extension',
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
          updateActiveSession(result);
        } else {
          updateActiveSession({
            ...result,
            comments: cloneComments(state.activeSession)
          });
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

  function resetTemplateSearchState(): void {
    for (const timer of templateSearchTimers.values()) {
      window.clearTimeout(timer);
    }
    templateSearchTimers.clear();
    templateSearchRevisions.clear();
  }

  function clearTemplateSearchController(cardId: string): void {
    const timer = templateSearchTimers.get(cardId);
    if (timer) {
      window.clearTimeout(timer);
      templateSearchTimers.delete(cardId);
    }
    templateSearchRevisions.delete(cardId);
    dialog.clearTemplateSearchState(cardId);
  }

  function updateActiveSession(nextSession: ReviewSessionData | null): void {
    state.activeSession = nextSession;
    if (!nextSession) {
      resetTemplateSearchState();
    }
  }

  function scheduleTemplateSearch(cardId: string, query: string): void {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      return;
    }

    const trimmed = query.trim();
    const nextRevision = (templateSearchRevisions.get(cardId) || 0) + 1;
    templateSearchRevisions.set(cardId, nextRevision);

    const pendingTimer = templateSearchTimers.get(cardId);
    if (pendingTimer) {
      window.clearTimeout(pendingTimer);
    }

    dialog.setTemplateSearchState(cardId, {
      query: trimmed,
      loading: Boolean(trimmed),
      error: '',
      results: []
    });

    if (!trimmed) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchReviewTemplates({
          backendBaseUrl: state.settings.backendBaseUrl.trim(),
          backendBaseUrlFallbacks: getBackendBaseCandidates(),
          query: trimmed,
          limit: 6
        });

        if (templateSearchRevisions.get(cardId) !== nextRevision) {
          return;
        }

        dialog.setTemplateSearchState(cardId, {
          loading: false,
          error: '',
          results: (result.results || []) as TemplateSearchResult[]
        });
      } catch (error) {
        if (templateSearchRevisions.get(cardId) !== nextRevision) {
          return;
        }
        dialog.setTemplateSearchState(cardId, {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          results: []
        });
      } finally {
        templateSearchTimers.delete(cardId);
      }
    }, 280);

    templateSearchTimers.set(cardId, timer);
  }

  async function assignCardTemplateMatch(cardId: string, templateId: string): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveSessionCommentsNow();
    dialog.setBusy(true, 'Applying manual template match...');
    const session = await updateReviewSessionCardTemplateMatch({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      sessionId,
      cardId,
      templateId
    });
    updateActiveSession(session);
    clearTemplateSearchController(cardId);
    dialog.renderSession(session, 'Template match updated for this change.');
  }

  async function clearCardTemplateMatch(cardId: string): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveSessionCommentsNow();
    dialog.setBusy(true, 'Removing template match...');
    const session = await clearReviewSessionCardTemplateMatch({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      sessionId,
      cardId
    });
    updateActiveSession(session);
    clearTemplateSearchController(cardId);
    dialog.renderSession(session, 'Template removed from this change.');
  }

  function requireActionId(): string {
    const actionId = getLiveReviewActionId();
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

  async function createInteractiveSession(run: ReviewRun): Promise<ReviewSessionData> {
    const result = await createReviewSession({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      reviewActionId: run.snapshot.reviewActionId,
      original: run.snapshot.original,
      current: run.snapshot.current,
      babelDiff: state.lastTranscriptionDiff
    });

    assertRun(run);
    resetTemplateSearchState();
    updateActiveSession(result);
    commentRevision = 0;
    savedCommentRevision = 0;
    window.clearTimeout(commentSaveTimer);
    commentSaveTimer = 0;
    return result;
  }

  async function runFastMagicReview(run: ReviewRun): Promise<void> {
    const result = await generate({
      backendBaseUrl: state.settings.backendBaseUrl.trim(),
      backendBaseUrlFallbacks: getBackendBaseCandidates(),
      reviewActionId: run.snapshot.reviewActionId,
      original: run.snapshot.original,
      current: run.snapshot.current,
      babelDiff: state.lastTranscriptionDiff
    });

    state.lastAiReview = result?.llm || null;
    const feedback = Array.isArray(result?.llm?.feedback) ? result.llm.feedback : [];
    if (!feedback.length) {
      throw new Error('Backend returned empty feedback.');
    }

    const snapshot = await prepareApplication(run);
    const applied = await form.applyFeedback(feedback);
    if (!applied.applied) {
      throw new Error('Could not find review form fields to apply feedback.');
    }
    await applyPreparedGrades(run, snapshot);
    activeRun = null;

    form.setState('done', `Applied (${applied.applied})`);
    form.pushToast(`Applied feedback to ${applied.applied} categories.`, false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1600);
  }

  async function runInteractiveMagicReview(run: ReviewRun): Promise<void> {
    dialog.openLoading('Preparing review session...');

    const result = await createInteractiveSession(run);
    dialog.renderSession(result, 'Expand a change to inspect the system opinion.');
    if (run.error) throw run.error;
    form.setState('done', 'Review Open');
    form.pushToast('Opened interactive review dialog.', false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1200);
  }

  async function refreshInteractiveSession(): Promise<void> {
    const { actionId } = requireBaseline();
    cancelReviewRun();
    updateActiveSession(null);
    const revision = reviewRevision;
    const route = window.location.href;
    dialog.setBusy(true, 'Refreshing analysis...');
    form.setGradingStatus('Preparing review…');

    try {
      await refreshLatestCurrent(actionId);
      await refreshStableOriginal(actionId);
      const run = beginReviewRun(actionId, revision, route);
      const session = await createInteractiveSession(run);
      dialog.renderSession(session, 'Refreshed with the latest review state.');
      if (run.error) throw run.error;
    } catch (error) {
      if (revision === reviewRevision) {
        cancelReviewRun();
        form.setGradingStatus('Grading not ready — retry Magic Review', true);
      }
      throw error;
    }
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
    updateActiveSession(session);
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
    updateActiveSession(session);
    dialog.renderSession(session, decision === 'approved' ? 'Suggestion approved.' : 'Suggestion rejected.');
  }

  async function finalizeInteractiveSession(mode: 'apply' | 'skip'): Promise<void> {
    const sessionId = state.activeSession?.sessionId;
    if (!sessionId) {
      throw new Error('Interactive review session is not ready.');
    }

    const run = activeRun;
    if (!run) throw new Error('The review changed. Refresh Magic Review before applying.');
    assertRun(run);
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

    const snapshot = await prepareApplication(run);
    const applied = await form.applyFeedback(feedback);
    state.lastAiReview = result.aiReview || { feedback };

    if (!applied.applied) {
      throw new Error('Interactive review could not find review form fields.');
    }
    await applyPreparedGrades(run, snapshot);
    activeRun = null;

    updateActiveSession(null);
    dialog.close();
    form.setState('done', `Applied (${applied.applied})`);
    form.pushToast(`Applied feedback to ${applied.applied} categories.`, false);
    window.setTimeout(() => form.setState('idle', 'Magic Review'), 1600);
  }

  async function runMagicReview(): Promise<void> {
    if (state.generating) {
      return;
    }

    state.generating = true;
    cancelReviewRun();
    reviewRoute = window.location.href;
    const revision = reviewRevision;
    const route = reviewRoute;
    form.setState('loading', 'Finding task...');
    form.setGradingStatus('Preparing review…');

    try {
      resetReviewSnapshot();
      const actionId = await ensureCurrentReviewActionId();
      form.setState('loading', state.settings.workflowMode === 'interactive' ? 'Opening...' : 'Generating...');

      await refreshLatestCurrent(actionId);
      await refreshStableOriginal(actionId);

      const run = beginReviewRun(actionId, revision, route);

      if (state.settings.workflowMode === 'interactive') {
        await runInteractiveMagicReview(run);
      } else {
        await runFastMagicReview(run);
      }
    } catch (error) {
      if (revision === reviewRevision) {
        cancelReviewRun();
        form.setGradingStatus('Grades not applied — retry Magic Review', true);
      }
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
        cancelReviewRun();
        updateActiveSession(null);
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
          form.setGradingStatus('Grades not applied — refresh Magic Review', true);
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Apply failed: ${message}`, true);
        }
      },
      onCardCommentChange: (cardId, value) => {
        updateLocalCardComment(cardId, value);
      },
      onTemplateSearch: (cardId, query) => {
        scheduleTemplateSearch(cardId, query);
      },
      onTemplateSelect: async (cardId, templateId) => {
        try {
          await assignCardTemplateMatch(cardId, templateId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Template match failed: ${message}`, true);
        }
      },
      onTemplateClear: async (cardId) => {
        try {
          await clearCardTemplateMatch(cardId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dialog.setStatus(message, true);
          form.pushToast(`Template removal failed: ${message}`, true);
        }
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
      bridge.prefillReviewerRatings();
      window.addEventListener('popstate', checkRoute);
      window.addEventListener('hashchange', checkRoute);
      window.addEventListener('pagehide', () => cancelReviewRun());

      try {
        const stored = await loadState();
        state.settings = sanitizeSettings(stored.settings);
        void saveState({
          sessions: {},
          settings: state.settings,
          selectedSessionId: ''
        });
      } catch {
        // Keep defaults when storage is unavailable; captures remain in memory.
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
      const revision = reviewRevision;
      if (grader) {
        void grader.available().then(available => {
          if (revision === reviewRevision && !activeRun) {
            form.setGradingStatus(available ? 'Grading ready' : 'Grading unavailable — reload the addon', !available);
          }
        }).catch(() => {
          if (revision === reviewRevision && !activeRun) form.setGradingStatus('Grading unavailable — reload the addon', true);
        });
      } else {
        form.setGradingStatus('Grading unavailable — comments only');
      }
    },
    ensureMagicButton(): void {
      checkRoute();
      bridge.prefillReviewerRatings();
      form.ensure(() => runMagicReview());
    }
  };
}
