import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  clearReviewSessionCardTemplateMatch,
  decideReviewSessionSuggestion,
  finalizeReviewSession,
  generateReviewSessionSuggestions,
  getReviewSession,
  saveReviewSessionComments,
  searchReviewTemplates,
  updateReviewSessionCardTemplateMatch
} from '../core/backend-client';
import { DEFAULT_SETTINGS } from '../core/constants';
import { enqueueApplyCommand, loadState } from '../core/storage';
import type { ReviewSessionApplyCommand, ReviewSessionData } from '../core/types';
import { ReviewWorkspace } from '../ui/review-workspace';
import { createReviewWorkspaceStore } from '../ui/review-workspace-store';
import { ensureReviewUiStyles } from '../ui/styles';

const query = new URLSearchParams(window.location.search);
const sessionId = query.get('sessionId') || '';
const reviewActionId = query.get('reviewActionId') || '';
const clientId = query.get('clientId') || '';
const initialError = query.get('error') || '';
const initialStatus = query.get('status') || '';

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function SessionApp() {
  const store = useMemo(() => createReviewWorkspaceStore(), []);
  const sessionRef = useRef<ReviewSessionData | null>(null);
  const settingsRef = useRef({
    backendBaseUrl: DEFAULT_SETTINGS.backendBaseUrl,
    backendBaseUrlFallbacks: [...DEFAULT_SETTINGS.backendBaseUrlFallbacks]
  });
  const saveTimerRef = useRef<number>(0);
  const saveRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const searchTimersRef = useRef(new Map<string, number>());
  const searchRevisionRef = useRef(new Map<string, number>());

  const getBaseArgs = useCallback(() => ({
    backendBaseUrl: settingsRef.current.backendBaseUrl,
    backendBaseUrlFallbacks: settingsRef.current.backendBaseUrlFallbacks
  }), []);

  const syncCommentIntoSession = useCallback((cardId: string, value: string) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    if (!session.comments) {
      session.comments = { sessionComment: '', cardComments: {} };
    }
    if (value.trim()) {
      session.comments.cardComments[cardId] = value;
    } else {
      delete session.comments.cardComments[cardId];
    }
  }, []);

  const syncSessionComment = useCallback((value: string) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    if (!session.comments) {
      session.comments = { sessionComment: '', cardComments: {} };
    }
    session.comments.sessionComment = value;
  }, []);

  const saveCommentsNow = useCallback(async () => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;

    const session = sessionRef.current;
    if (!session || saveRevisionRef.current === savedRevisionRef.current) {
      return;
    }

    const targetRevision = saveRevisionRef.current;
    const comments = {
      sessionComment: session.comments?.sessionComment || '',
      cardComments: { ...(session.comments?.cardComments || {}) }
    };

    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await saveReviewSessionComments({
          ...getBaseArgs(),
          sessionId: session.sessionId,
          sessionComment: comments.sessionComment,
          cardComments: comments.cardComments
        });

        if (!sessionRef.current || sessionRef.current.sessionId !== result.sessionId) {
          return;
        }

        savedRevisionRef.current = Math.max(savedRevisionRef.current, targetRevision);
        sessionRef.current = {
          ...result,
          comments
        };
      });

    await saveChainRef.current;
  }, [getBaseArgs]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveCommentsNow();
    }, 450);
  }, [saveCommentsNow]);

  const replaceSession = useCallback((session: ReviewSessionData, status: string, resetUi = false) => {
    sessionRef.current = session;
    store.getState().replaceSession(session, status, resetUi);
  }, [store]);

  const resetSearchControllers = useCallback(() => {
    for (const timer of searchTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    searchTimersRef.current.clear();
    searchRevisionRef.current.clear();
  }, []);

  const clearSearchController = useCallback((cardId: string) => {
    const timer = searchTimersRef.current.get(cardId);
    if (timer) {
      window.clearTimeout(timer);
      searchTimersRef.current.delete(cardId);
    }
    searchRevisionRef.current.delete(cardId);
    store.getState().clearTemplateSearchState(cardId);
  }, [store]);

  const refreshSession = useCallback(async () => {
    if (!sessionId) {
      store.getState().setStatus(
        initialError || (initialStatus === 'pending' ? 'Waiting for session creation...' : 'Session ID missing.'),
        !!initialError
      );
      return;
    }

    store.getState().setBusy(true, 'Loading session...');
    try {
      const session = await getReviewSession({
        ...getBaseArgs(),
        sessionId
      });
      replaceSession(session, 'Session loaded.');
    } catch (error) {
      store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }, [getBaseArgs, replaceSession, store]);

  const handleTemplateSearch = useCallback((cardId: string, queryValue: string) => {
    const nextRevision = (searchRevisionRef.current.get(cardId) || 0) + 1;
    searchRevisionRef.current.set(cardId, nextRevision);

    const timer = searchTimersRef.current.get(cardId);
    if (timer) {
      window.clearTimeout(timer);
    }

    const trimmed = queryValue.trim();
    store.getState().setTemplateSearchState(cardId, {
      query: queryValue,
      loading: false,
      error: '',
      ...(trimmed ? {} : { results: [] })
    });

    if (!trimmed) {
      return;
    }

    searchTimersRef.current.set(
      cardId,
      window.setTimeout(async () => {
        store.getState().setTemplateSearchState(cardId, { query: queryValue, loading: true, error: '' });
        try {
          const result = await searchReviewTemplates({
            ...getBaseArgs(),
            query: trimmed,
            limit: 6
          });
          if (searchRevisionRef.current.get(cardId) !== nextRevision) {
            return;
          }
          store.getState().setTemplateSearchState(cardId, {
            query: queryValue,
            loading: false,
            error: '',
            results: result.results || []
          });
        } catch (error) {
          if (searchRevisionRef.current.get(cardId) !== nextRevision) {
            return;
          }
          store.getState().setTemplateSearchState(cardId, {
            query: queryValue,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            results: []
          });
        } finally {
          searchTimersRef.current.delete(cardId);
        }
      }, 180)
    );
  }, [getBaseArgs, store]);

  const handleTemplateSelect = useCallback(async (cardId: string, templateId: string) => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveCommentsNow();
    store.getState().setBusy(true, 'Applying manual template match...');
    const session = await updateReviewSessionCardTemplateMatch({
      ...getBaseArgs(),
      sessionId: activeSession.sessionId,
      cardId,
      templateId
    });
    clearSearchController(cardId);
    replaceSession(session, 'Template match updated.');
  }, [clearSearchController, getBaseArgs, replaceSession, saveCommentsNow, store]);

  const handleTemplateClear = useCallback(async (cardId: string) => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveCommentsNow();
    store.getState().setBusy(true, 'Removing template match...');
    const session = await clearReviewSessionCardTemplateMatch({
      ...getBaseArgs(),
      sessionId: activeSession.sessionId,
      cardId
    });
    clearSearchController(cardId);
    replaceSession(session, 'Template removed from this change.');
  }, [clearSearchController, getBaseArgs, replaceSession, saveCommentsNow, store]);

  const handleGenerateSuggestions = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveCommentsNow();
    store.getState().setBusy(true, 'Generating template suggestions...');
    const session = await generateReviewSessionSuggestions({
      ...getBaseArgs(),
      sessionId: activeSession.sessionId
    });
    replaceSession(session, session.suggestions?.length ? 'Suggestions ready.' : 'No suggestions were generated.');
  }, [getBaseArgs, replaceSession, saveCommentsNow, store]);

  const handleSuggestionDecision = useCallback(async (proposalId: string, decision: 'approved' | 'rejected') => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      throw new Error('Interactive review session is not ready.');
    }

    store.getState().setBusy(true, decision === 'approved' ? 'Approving suggestion...' : 'Rejecting suggestion...');
    const session = await decideReviewSessionSuggestion({
      ...getBaseArgs(),
      sessionId: activeSession.sessionId,
      proposalId,
      decision
    });
    replaceSession(session, decision === 'approved' ? 'Suggestion approved.' : 'Suggestion rejected.');
  }, [getBaseArgs, replaceSession, store]);

  const handleFinalize = useCallback(async (mode: 'apply' | 'skip') => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      throw new Error('Interactive review session is not ready.');
    }

    await saveCommentsNow();
    store.getState().setBusy(true, mode === 'apply' ? 'Applying final review...' : 'Applying immediate review...');
    const payload = await finalizeReviewSession({
      ...getBaseArgs(),
      sessionId: activeSession.sessionId,
      mode
    });

    const command: ReviewSessionApplyCommand = {
      commandId: createId('cmd'),
      sessionId: activeSession.sessionId,
      reviewActionId: payload.reviewActionId || reviewActionId,
      clientId,
      createdAt: new Date().toISOString(),
      feedback: payload.categoryFeedback || [],
      aiReview: payload.aiReview || {
        feedback: payload.categoryFeedback || []
      }
    };

    await enqueueApplyCommand(command);
    store.getState().setStatus('Feedback queued for application in Babel.');
    window.setTimeout(() => window.close(), 300);
  }, [getBaseArgs, saveCommentsNow, store]);

  useEffect(() => {
    ensureReviewUiStyles();
    void (async () => {
      const stored = await loadState();
      settingsRef.current = {
        backendBaseUrl: stored.settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl,
        backendBaseUrlFallbacks:
          stored.settings.backendBaseUrlFallbacks?.length
            ? stored.settings.backendBaseUrlFallbacks
            : [...DEFAULT_SETTINGS.backendBaseUrlFallbacks]
      };

      if (initialError) {
        store.getState().setStatus(initialError, true);
      } else if (initialStatus === 'pending' && !sessionId) {
        store.getState().setStatus('Waiting for session creation...');
      }

      await refreshSession();
    })().catch((error) => {
      store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
    });

    return () => {
      window.clearTimeout(saveTimerRef.current);
      resetSearchControllers();
    };
  }, [refreshSession, resetSearchControllers, store]);

  return (
    <ReviewWorkspace
      onCardCommentChange={(cardId, value) => {
        syncCommentIntoSession(cardId, value);
        saveRevisionRef.current += 1;
        scheduleSave();
      }}
      onFinalize={(mode) => void handleFinalize(mode).catch((error) => {
        store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
      })}
      onGenerateSuggestions={() => void handleGenerateSuggestions().catch((error) => {
        store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
      })}
      onRefresh={() => void refreshSession()}
      onSessionCommentChange={(value) => {
        syncSessionComment(value);
        saveRevisionRef.current += 1;
        scheduleSave();
      }}
      onSuggestionDecision={(proposalId, decision) => void handleSuggestionDecision(proposalId, decision).catch((error) => {
        store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
      })}
      onTemplateClear={(cardId) => void handleTemplateClear(cardId).catch((error) => {
        store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
      })}
      onTemplateSearchChange={handleTemplateSearch}
      onTemplateSelect={(cardId, templateId) => void handleTemplateSelect(cardId, templateId).catch((error) => {
        store.getState().setStatus(error instanceof Error ? error.message : String(error), true);
      })}
      store={store}
      variant="page"
    />
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Session root element is missing.');
}

createRoot(rootElement).render(<SessionApp />);
