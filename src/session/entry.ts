import {
  decideReviewSessionSuggestion,
  finalizeReviewSession,
  generateReviewSessionSuggestions,
  getReviewSession,
  saveReviewSessionComments
} from '../core/backend-client';
import { DEFAULT_SETTINGS } from '../core/constants';
import { enqueueApplyCommand, loadState } from '../core/storage';
import type { ReviewSessionApplyCommand, ReviewSessionCard, ReviewSessionData, ReviewSessionSuggestion } from '../core/types';

const els = {
  title: document.getElementById('sessionTitle') as HTMLHeadingElement,
  subtitle: document.getElementById('sessionSubtitle') as HTMLParagraphElement,
  status: document.getElementById('status') as HTMLDivElement,
  summary: document.getElementById('summary') as HTMLDivElement,
  cards: document.getElementById('cards') as HTMLDivElement,
  sessionComment: document.getElementById('sessionComment') as HTMLTextAreaElement,
  saveIndicator: document.getElementById('saveIndicator') as HTMLSpanElement,
  suggestions: document.getElementById('suggestions') as HTMLDivElement,
  generateSuggestionsBtn: document.getElementById('generateSuggestionsBtn') as HTMLButtonElement,
  applyNowBtn: document.getElementById('applyNowBtn') as HTMLButtonElement,
  applyFinalBtn: document.getElementById('applyFinalBtn') as HTMLButtonElement,
  refreshBtn: document.getElementById('refreshBtn') as HTMLButtonElement
};

const query = new URLSearchParams(window.location.search);
const sessionId = query.get('sessionId') || '';
const reviewActionId = query.get('reviewActionId') || '';
const clientId = query.get('clientId') || '';
const initialError = query.get('error') || '';
const initialStatus = query.get('status') || '';

const state = {
  backendBaseUrl: DEFAULT_SETTINGS.backendBaseUrl,
  backendBaseUrlFallbacks: [...DEFAULT_SETTINGS.backendBaseUrlFallbacks],
  session: null as ReviewSessionData | null,
  cardComments: {} as Record<string, string>,
  sessionComment: '',
  saveTimer: 0,
  saving: false,
  busy: false
};

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.dataset.error = isError ? 'true' : 'false';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getBaseArgs() {
  return {
    backendBaseUrl: state.backendBaseUrl,
    backendBaseUrlFallbacks: state.backendBaseUrlFallbacks
  };
}

function setBusy(next: boolean): void {
  state.busy = next;
  els.generateSuggestionsBtn.disabled = next;
  els.applyNowBtn.disabled = next;
  els.applyFinalBtn.disabled = next;
  els.refreshBtn.disabled = next;
}

function renderSummary(session: ReviewSessionData): void {
  const matchedCount = session.cards.filter((card) => !!card.matchedTemplateId).length;
  els.summary.innerHTML = [
    `<div class="summary-item"><strong>${session.cards.length}</strong><span>Changes</span></div>`,
    `<div class="summary-item"><strong>${matchedCount}</strong><span>Matched</span></div>`,
    `<div class="summary-item"><strong>${session.suggestions.length}</strong><span>Suggestions</span></div>`
  ].join('');
}

function renderCards(cards: ReviewSessionCard[]): void {
  if (!cards.length) {
    els.cards.innerHTML = '<div class="empty-state">No changes were detected for this review.</div>';
    return;
  }

  els.cards.innerHTML = cards
    .map((card) => {
      const cardId = String(card.id || card.changeIndex);
      const comment = state.cardComments[cardId] || '';
      return [
        '<article class="card">',
        '<div class="card-head">',
        `<span class="pill">Change ${escapeHtml(card.changeIndex)}</span>`,
        `<span class="pill type">${escapeHtml(card.type || 'UNKNOWN')}</span>`,
        '</div>',
        `<div class="card-body">${escapeHtml(card.description || '')}</div>`,
        '<div class="card-opinion">',
        `<div class="opinion-title">${escapeHtml(card.templateTitle || 'No system issue selected')}</div>`,
        `<div class="opinion-text">${escapeHtml(card.opinionText || 'This change is currently unmatched. Add feedback if the system should learn from it.')}</div>`,
        `<div class="opinion-rationale">${escapeHtml(card.rationale || card.templateDescription || '')}</div>`,
        '</div>',
        '<label class="comment-label">Reviewer feedback</label>',
        `<textarea class="card-comment" data-card-id="${escapeHtml(cardId)}" rows="4" placeholder="Tell the system what should be improved for this change...">${escapeHtml(comment)}</textarea>`,
        '</article>'
      ].join('');
    })
    .join('');
}

function renderSuggestions(suggestions: ReviewSessionSuggestion[]): void {
  if (!suggestions.length) {
    els.suggestions.innerHTML = '<div class="empty-state">No pending template suggestions yet.</div>';
    return;
  }

  els.suggestions.innerHTML = suggestions
    .map((suggestion) => {
      const variants = Array.isArray(suggestion.reportTexts) && suggestion.reportTexts.length
        ? `<ul class="variant-list">${suggestion.reportTexts
            .map((text) => `<li>${escapeHtml(text)}</li>`)
            .join('')}</ul>`
        : '<div class="muted">No template text variants proposed.</div>';
      const decision = suggestion.decision || 'pending';
      return [
        '<article class="suggestion-card">',
        '<div class="card-head">',
        `<span class="pill">${escapeHtml(suggestion.operation)}</span>`,
        `<span class="pill type">${escapeHtml(suggestion.category)}</span>`,
        '</div>',
        `<div class="suggestion-title">${escapeHtml(suggestion.title || suggestion.targetTemplateId || 'Untitled proposal')}</div>`,
        `<div class="suggestion-reason">${escapeHtml(suggestion.reason || '')}</div>`,
        suggestion.description ? `<div class="suggestion-description">${escapeHtml(suggestion.description)}</div>` : '',
        variants,
        `<div class="suggestion-meta">Source cards: ${escapeHtml((suggestion.sourceCardIds || []).join(', ') || 'n/a')}</div>`,
        '<div class="suggestion-actions">',
        `<button class="secondary suggestion-decision" data-proposal-id="${escapeHtml(suggestion.proposalId)}" data-decision="approved" ${decision !== 'pending' ? 'disabled' : ''}>Approve</button>`,
        `<button class="secondary suggestion-decision" data-proposal-id="${escapeHtml(suggestion.proposalId)}" data-decision="rejected" ${decision !== 'pending' ? 'disabled' : ''}>Reject</button>`,
        `<span class="decision-state">${escapeHtml(decision)}</span>`,
        '</div>',
        '</article>'
      ].join('');
    })
    .join('');
}

function syncCommentsFromSession(session: ReviewSessionData): void {
  state.sessionComment = session.comments?.sessionComment || '';
  state.cardComments = { ...(session.comments?.cardComments || {}) };
  els.sessionComment.value = state.sessionComment;
}

function renderSession(session: ReviewSessionData): void {
  state.session = session;
  syncCommentsFromSession(session);
  els.title.textContent = `Interactive Review ${session.reviewActionId || reviewActionId}`;
  els.subtitle.textContent = session.sessionId
    ? `Session ${session.sessionId}`
    : 'Interactive review session';
  renderSummary(session);
  renderCards(session.cards || []);
  renderSuggestions(session.suggestions || []);
}

async function refreshSession(): Promise<void> {
  if (!sessionId) {
    if (initialStatus === 'pending') {
      setStatus('Waiting for session creation...', false);
    } else if (initialError) {
      setStatus(initialError, true);
    } else {
      setStatus('Session ID missing. Re-open the interactive review from Babel.', true);
    }
    return;
  }

  setBusy(true);
  try {
    const session = await getReviewSession({
      ...getBaseArgs(),
      sessionId
    });
    renderSession(session);
    setStatus('Session loaded.', false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(false);
  }
}

async function saveComments(): Promise<void> {
  if (!sessionId) {
    return;
  }

  if (state.saving) {
    return;
  }

  state.saving = true;
  els.saveIndicator.textContent = 'Saving...';

  try {
    const session = await saveReviewSessionComments({
      ...getBaseArgs(),
      sessionId,
      sessionComment: state.sessionComment,
      cardComments: state.cardComments
    });
    renderSession(session);
    els.saveIndicator.textContent = 'Saved';
  } catch (error) {
    els.saveIndicator.textContent = 'Save failed';
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    state.saving = false;
    window.setTimeout(() => {
      if (!state.saving) {
        els.saveIndicator.textContent = 'Idle';
      }
    }, 1000);
  }
}

function scheduleSave(): void {
  window.clearTimeout(state.saveTimer);
  els.saveIndicator.textContent = 'Unsaved';
  state.saveTimer = window.setTimeout(() => {
    void saveComments();
  }, 500);
}

async function onGenerateSuggestions(): Promise<void> {
  if (!sessionId) {
    return;
  }

  await saveComments();
  setBusy(true);
  setStatus('Generating template suggestions...', false);
  try {
    const session = await generateReviewSessionSuggestions({
      ...getBaseArgs(),
      sessionId
    });
    renderSession(session);
    setStatus('Template suggestions updated.', false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(false);
  }
}

async function onSuggestionDecision(proposalId: string, decision: 'approved' | 'rejected'): Promise<void> {
  if (!sessionId) {
    return;
  }

  setBusy(true);
  setStatus(`${decision === 'approved' ? 'Approving' : 'Rejecting'} proposal...`, false);
  try {
    const session = await decideReviewSessionSuggestion({
      ...getBaseArgs(),
      sessionId,
      proposalId,
      decision
    });
    renderSession(session);
    setStatus(`Proposal ${decision}.`, false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(false);
  }
}

async function onFinalize(mode: 'apply' | 'skip'): Promise<void> {
  if (!sessionId) {
    return;
  }

  await saveComments();
  setBusy(true);
  setStatus(mode === 'skip' ? 'Applying immediately...' : 'Applying final review...', false);

  try {
    const payload = await finalizeReviewSession({
      ...getBaseArgs(),
      sessionId,
      mode
    });

    const command: ReviewSessionApplyCommand = {
      commandId: createId('cmd'),
      sessionId,
      reviewActionId: payload.reviewActionId || reviewActionId,
      clientId,
      createdAt: new Date().toISOString(),
      feedback: payload.categoryFeedback || [],
      aiReview: payload.aiReview || {
        feedback: payload.categoryFeedback || []
      }
    };

    await enqueueApplyCommand(command);
    setStatus('Feedback queued for application in Babel.', false);
    window.setTimeout(() => window.close(), 400);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setBusy(false);
  }
}

async function boot(): Promise<void> {
  const stored = await loadState();
  state.backendBaseUrl = stored.settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl;
  state.backendBaseUrlFallbacks =
    stored.settings.backendBaseUrlFallbacks?.length
      ? stored.settings.backendBaseUrlFallbacks
      : [...DEFAULT_SETTINGS.backendBaseUrlFallbacks];

  if (initialError) {
    setStatus(initialError, true);
  } else if (initialStatus === 'pending' && !sessionId) {
    setStatus('Waiting for session creation...', false);
  }

  await refreshSession();
}

els.sessionComment.addEventListener('input', () => {
  state.sessionComment = els.sessionComment.value || '';
  scheduleSave();
});

els.cards.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }
  const cardId = target.dataset.cardId || '';
  if (!cardId) {
    return;
  }
  state.cardComments[cardId] = target.value || '';
  scheduleSave();
});

els.suggestions.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  if (!target.classList.contains('suggestion-decision')) {
    return;
  }
  const proposalId = target.dataset.proposalId || '';
  const decision = target.dataset.decision === 'approved' ? 'approved' : 'rejected';
  if (!proposalId) {
    return;
  }
  void onSuggestionDecision(proposalId, decision);
});

els.generateSuggestionsBtn.addEventListener('click', () => {
  void onGenerateSuggestions();
});

els.applyNowBtn.addEventListener('click', () => {
  void onFinalize('skip');
});

els.applyFinalBtn.addEventListener('click', () => {
  void onFinalize('apply');
});

els.refreshBtn.addEventListener('click', () => {
  void refreshSession();
});

void boot();
