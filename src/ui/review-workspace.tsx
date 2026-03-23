import React, { memo, useEffect, useMemo, useState } from 'react';
import type { ReviewEvidence, ReviewSessionData, ReviewSessionSuggestion } from '../core/types';
import type { ReviewWorkspaceStore, TemplateSearchState } from './review-workspace-store';
import {
  DEFAULT_TEMPLATE_SEARCH_STATE,
  ReviewWorkspaceStoreProvider,
  useReviewWorkspaceSelector
} from './review-workspace-store';

type ReviewWorkspaceHandlers = {
  onClose?: () => void;
  onBackdropClose?: () => void;
  onRefresh: () => void | Promise<void>;
  onGenerateSuggestions: () => void | Promise<void>;
  onFinalize: (mode: 'apply' | 'skip') => void | Promise<void>;
  onCardCommentChange: (cardId: string, value: string) => void;
  onSessionCommentChange: (value: string) => void;
  onSuggestionDecision: (proposalId: string, decision: 'approved' | 'rejected') => void | Promise<void>;
  onTemplateSearchChange: (cardId: string, query: string) => void;
  onTemplateSelect: (cardId: string, templateId: string) => void | Promise<void>;
  onTemplateClear: (cardId: string) => void | Promise<void>;
};

type ReviewWorkspaceProps = {
  store: ReviewWorkspaceStore;
  variant: 'overlay' | 'page';
  closeLabel?: string;
} & ReviewWorkspaceHandlers;

function describeMatchSource(card: ReviewSessionData['cards'][number]): string {
  switch (card.matchSource) {
    case 'manual':
      return card.initialMatchedTemplateId && card.initialMatchedTemplateId !== card.matchedTemplateId
        ? 'Manual reassignment'
        : 'Manual match';
    case 'manual_cleared':
      return 'Template removed';
    case 'model':
      return 'Model match';
    default:
      return card.matchedTemplateId ? 'Matched' : 'Unmatched';
  }
}

function deriveEvidence(card: ReviewSessionData['cards'][number]): ReviewEvidence | null {
  if (card.evidenceDetail) {
    return card.evidenceDetail;
  }
  const raw = String(card.evidence || card.description || '').trim();
  return raw ? { kind: 'raw', text: raw } : null;
}

function deriveSummary(card: ReviewSessionData['cards'][number]): string {
  const evidence = deriveEvidence(card);
  if (evidence?.kind === 'text-diff') {
    const before = String(evidence.before || '').trim();
    const after = String(evidence.after || '').trim();
    if (before || after) {
      return `${before || '(empty)'} -> ${after || '(empty)'}`;
    }
  }
  if (evidence?.kind === 'raw' && evidence.text.trim()) {
    return evidence.text.trim();
  }
  if (card.summary) {
    return card.summary;
  }
  return card.description || 'Detected change';
}

function renderEvidenceBlock(card: ReviewSessionData['cards'][number]) {
  const evidence = deriveEvidence(card);
  if (!evidence) {
    return null;
  }

  if (evidence.kind === 'text-diff') {
    return (
      <div className="br-block">
        <div className="br-label">Evidence</div>
        <div className="br-body">
          <div><strong>Before:</strong> {evidence.before || '(empty)'}</div>
          <div><strong>After:</strong> {evidence.after || '(empty)'}</div>
          {evidence.inlineDiff ? <div className="br-meta">{evidence.inlineDiff}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="br-block">
      <div className="br-label">Evidence</div>
      <div>{evidence.text}</div>
    </div>
  );
}

const TemplateSearchPanel = memo(function TemplateSearchPanel(props: {
  card: ReviewSessionData['cards'][number];
  cardId: string;
  busy: boolean;
  searchState: TemplateSearchState;
  open: boolean;
  onToggleOpen: () => void;
  onQueryChange: (value: string) => void;
  onSelect: (templateId: string) => void;
  onClear: () => void;
}) {
  const [localQuery, setLocalQuery] = useState(props.searchState.query);

  useEffect(() => {
    if (!props.open) {
      setLocalQuery('');
    }
  }, [props.open]);

  const previousTemplate =
    props.card.initialMatchedTemplateId && props.card.initialMatchedTemplateId !== props.card.matchedTemplateId
      ? props.card.initialTemplateTitle || props.card.initialMatchedTemplateId
      : '';

  if (!props.open) {
    return (
      <div className="br-inline-actions">
        <button
          className="br-button"
          disabled={props.busy}
          onClick={props.onToggleOpen}
          type="button"
        >
          {props.card.matchedTemplateId ? 'Change template' : 'Match template'}
        </button>
      </div>
    );
  }

  return (
    <div className="br-block">
      <div className="br-label">Template match</div>
      <div className="br-body">
        <div><strong>{props.card.templateTitle || props.card.matchedTemplateId || 'No template selected'}</strong></div>
        <div className="br-meta">
          {describeMatchSource(props.card)}
          {props.card.matchedTemplateId ? ` · ${props.card.matchedTemplateId}` : ''}
        </div>
        {previousTemplate ? <div className="br-meta">Originally matched: {previousTemplate}</div> : null}
        <div className="br-inline-actions">
          <button
            className="br-button"
            data-variant="danger"
            disabled={props.busy || !props.card.matchedTemplateId}
            onClick={props.onClear}
            type="button"
          >
            Remove template
          </button>
          <button
            className="br-button"
            data-variant="ghost"
            disabled={props.busy}
            onClick={props.onToggleOpen}
            type="button"
          >
            Close search
          </button>
        </div>
        <label className="br-label" htmlFor={`template-search-${props.cardId}`}>Search templates</label>
        <input
          id={`template-search-${props.cardId}`}
          className="br-input"
          disabled={props.busy}
          onChange={(event) => {
            const value = event.target.value;
            setLocalQuery(value);
            props.onQueryChange(value);
          }}
          placeholder="Title, description, id, category, or template text"
          type="text"
          value={localQuery}
        />
        {props.searchState.loading ? <div className="br-helper">Searching templates...</div> : null}
        {!props.searchState.loading && props.searchState.error ? (
          <div className="br-helper" style={{ color: 'var(--br-danger)' }}>{props.searchState.error}</div>
        ) : null}
        {!props.searchState.loading && !props.searchState.error && props.searchState.query && !props.searchState.results.length ? (
          <div className="br-helper">No templates matched this query.</div>
        ) : null}
        {props.searchState.results.length ? (
          <div className="br-search-results">
            {props.searchState.results.map((result) => (
              <div className="br-search-result" key={result.id}>
                <div className="br-row-top">
                  <div className="br-row-title">{result.title}</div>
                  <span className="br-badge" data-variant="warning">{result.category}</span>
                  <span className="br-meta">score {result.score.toFixed(1)}</span>
                </div>
                <div>{result.description}</div>
                {result.reportTexts[0] ? <div className="br-meta">{result.reportTexts[0]}</div> : null}
                <div className="br-inline-actions">
                  <button
                    className="br-button"
                    data-variant="ghost"
                    disabled={props.busy}
                    onClick={() => props.onSelect(result.id)}
                    type="button"
                  >
                    Match to template
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const ReviewCard = memo(function ReviewCard(props: {
  card: ReviewSessionData['cards'][number];
  busy: boolean;
  onCommentChange: (cardId: string, value: string) => void;
  onTemplateSearchChange: (cardId: string, value: string) => void;
  onTemplateSelect: (cardId: string, templateId: string) => void;
  onTemplateClear: (cardId: string) => void;
}) {
  const cardId = String(props.card.id || props.card.changeIndex);
  const expanded = useReviewWorkspaceSelector((state) => !!state.expandedRows[cardId]);
  const comment = useReviewWorkspaceSelector((state) => state.cardCommentDrafts[cardId] || '');
  const searchState = useReviewWorkspaceSelector(
    (state) => state.templateSearch[cardId] || DEFAULT_TEMPLATE_SEARCH_STATE
  );
  const searchOpen = useReviewWorkspaceSelector((state) => !!state.templateSearchOpen[cardId]);
  const setExpandedRow = useReviewWorkspaceSelector((state) => state.setExpandedRow);
  const setCardCommentDraft = useReviewWorkspaceSelector((state) => state.setCardCommentDraft);
  const setTemplateSearchOpen = useReviewWorkspaceSelector((state) => state.setTemplateSearchOpen);

  return (
    <div className="br-card">
      <details
        open={expanded}
        onToggle={(event) => setExpandedRow(cardId, (event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <div className="br-row-top">
            <span className="br-pill-dot" data-variant={props.card.matchedTemplateId ? 'matched' : 'unmatched'} />
            <div>
              <div className="br-row-title">
                Change {props.card.changeIndex}: {deriveSummary(props.card)}
              </div>
              <div className="br-meta">
                {props.card.templateTitle || 'No template selected'}
              </div>
            </div>
            <span className="br-badge" data-variant="warning">{props.card.type || 'UNKNOWN'}</span>
          </div>
        </summary>
        <div className="br-stack" style={{ marginTop: 10 }}>
          <div>
            <div className="br-label">System opinion</div>
            <div className="br-meta">{describeMatchSource(props.card)}</div>
            <div>{props.card.opinionText || 'No system issue selected for this change.'}</div>
            {props.card.rationale ? <div className="br-meta">{props.card.rationale}</div> : null}
          </div>
          {renderEvidenceBlock(props.card)}
          <TemplateSearchPanel
            busy={props.busy}
            card={props.card}
            cardId={cardId}
            open={searchOpen}
            onToggleOpen={() => setTemplateSearchOpen(cardId, !searchOpen)}
            onClear={() => props.onTemplateClear(cardId)}
            onQueryChange={(value) => props.onTemplateSearchChange(cardId, value)}
            onSelect={(templateId) => props.onTemplateSelect(cardId, templateId)}
            searchState={searchState}
          />
          <div className="br-block">
            <div className="br-label">Reviewer comment</div>
            <textarea
              className="br-textarea"
              disabled={props.busy}
              onChange={(event) => {
                const value = event.target.value;
                setCardCommentDraft(cardId, value);
                props.onCommentChange(cardId, value);
              }}
              placeholder="Tell the system what should be improved for this change..."
              value={comment}
            />
          </div>
        </div>
      </details>
    </div>
  );
});

const SuggestionsList = memo(function SuggestionsList(props: {
  busy: boolean;
  suggestions: ReviewSessionSuggestion[];
  onDecision: (proposalId: string, decision: 'approved' | 'rejected') => void;
}) {
  if (!props.suggestions.length) {
    return <div className="br-empty">No template suggestions yet.</div>;
  }

  return (
    <div className="br-suggestions">
      {props.suggestions.map((suggestion) => {
        const decision = suggestion.decision || 'pending';
        return (
          <div className="br-suggestion" key={suggestion.proposalId}>
            <div className="br-suggestion-top">
              <span className="br-badge">{suggestion.operation}</span>
              <span className="br-badge" data-variant="warning">{suggestion.category}</span>
              <span className="br-meta">{decision}</span>
            </div>
            <div className="br-suggestion-title">{suggestion.title || suggestion.targetTemplateId || 'Untitled suggestion'}</div>
            {suggestion.description ? <div>{suggestion.description}</div> : null}
            <div className="br-meta">{suggestion.reason}</div>
            <div className="br-meta">Source cards: {(suggestion.sourceCardIds || []).join(', ') || 'n/a'}</div>
            {Array.isArray(suggestion.reportTexts) && suggestion.reportTexts.length ? (
              <div className="br-block">
                <div className="br-label">Template text</div>
                <div>{suggestion.reportTexts.join('\n\n')}</div>
              </div>
            ) : null}
            <div className="br-inline-actions">
              <button
                className="br-button"
                data-variant="ghost"
                disabled={props.busy || decision !== 'pending'}
                onClick={() => props.onDecision(suggestion.proposalId, 'approved')}
                type="button"
              >
                Approve
              </button>
              <button
                className="br-button"
                data-variant="danger"
                disabled={props.busy || decision !== 'pending'}
                onClick={() => props.onDecision(suggestion.proposalId, 'rejected')}
                type="button"
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function WorkspaceInner(props: Omit<ReviewWorkspaceProps, 'store'>) {
  const open = useReviewWorkspaceSelector((state) => state.open);
  const busy = useReviewWorkspaceSelector((state) => state.busy);
  const loading = useReviewWorkspaceSelector((state) => state.loading);
  const error = useReviewWorkspaceSelector((state) => state.error);
  const title = useReviewWorkspaceSelector((state) => state.title);
  const status = useReviewWorkspaceSelector((state) => state.status);
  const session = useReviewWorkspaceSelector((state) => state.session);
  const sessionCommentDraft = useReviewWorkspaceSelector((state) => state.sessionCommentDraft);
  const suggestionsExpanded = useReviewWorkspaceSelector((state) => state.suggestionsExpanded);
  const toggleSuggestionsExpanded = useReviewWorkspaceSelector((state) => state.toggleSuggestionsExpanded);
  const setSessionCommentDraft = useReviewWorkspaceSelector((state) => state.setSessionCommentDraft);

  const matchedCount = useMemo(
    () => (session?.cards || []).filter((card) => !!card.matchedTemplateId).length,
    [session]
  );

  const content = (
    <div className={props.variant === 'page' ? 'br-page' : ''}>
      <div className="br-page-shell">
        <div className="br-shell-surface">
          <div className="br-header">
            <div>
              <div className="br-header-title">{title}</div>
              <div className="br-header-status" data-error={error}>
                {status}
              </div>
            </div>
            <div className="br-toolbar">
              <button
                className="br-button"
                disabled={busy || !session}
                onClick={() => props.onRefresh()}
                type="button"
              >
                Refresh
              </button>
              <button
                className="br-button"
                disabled={busy || !session}
                onClick={() => props.onGenerateSuggestions()}
                type="button"
              >
                Generate suggestions
              </button>
              <button
                className="br-button"
                disabled={busy || !session}
                onClick={() => props.onFinalize('skip')}
                type="button"
              >
                Apply without review
              </button>
              <button
                className="br-button"
                data-variant="primary"
                disabled={busy || !session}
                onClick={() => props.onFinalize('apply')}
                type="button"
              >
                Apply
              </button>
              {props.onClose ? (
                <button
                  aria-label={props.closeLabel || 'Close'}
                  className="br-button"
                  data-variant="ghost"
                  disabled={busy}
                  onClick={props.onClose}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>

          <div className="br-main">
            {loading && !session ? (
              <div className="br-empty">Preparing review session…</div>
            ) : null}

            {session ? (
              <>
                <div className="br-summary-bar">
                  <div className="br-summary-pill">
                    <span className="br-summary-dot" />
                    <span>{session.cards.length} changes</span>
                  </div>
                  <span>·</span>
                  <span>{matchedCount} matched</span>
                  <span>·</span>
                  <span>{session.suggestions.length} suggestions</span>
                </div>

                <div className="br-divider" />

                <div className="br-stack">
                  {session.cards.length ? (
                    session.cards.map((card) => (
                      <ReviewCard
                        busy={busy}
                        card={card}
                        key={card.id || card.changeIndex}
                        onCommentChange={props.onCardCommentChange}
                        onTemplateClear={props.onTemplateClear}
                        onTemplateSearchChange={props.onTemplateSearchChange}
                        onTemplateSelect={props.onTemplateSelect}
                      />
                    ))
                  ) : (
                    <div className="br-empty">No changes were detected for this review.</div>
                  )}
                </div>

                <div className="br-divider" />

                <section>
                  <div className="br-section-header">
                    <div className="br-section-title">Improve the system</div>
                    <button
                      className="br-button"
                      data-variant="ghost"
                      onClick={toggleSuggestionsExpanded}
                      type="button"
                    >
                      {suggestionsExpanded ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {suggestionsExpanded ? (
                    <div className="br-stack">
                      <div className="br-block">
                        <div className="br-label">General reviewer comment</div>
                        <textarea
                          className="br-textarea"
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSessionCommentDraft(value);
                            props.onSessionCommentChange(value);
                          }}
                          placeholder="Optional note for the entire review session..."
                          value={sessionCommentDraft}
                        />
                      </div>
                      <SuggestionsList
                        busy={busy}
                        onDecision={props.onSuggestionDecision}
                        suggestions={session.suggestions || []}
                      />
                    </div>
                  ) : null}
                </section>
              </>
            ) : !loading ? (
              <div className="br-empty">Session is not available.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (props.variant === 'overlay') {
    if (!open) {
      return null;
    }
    return (
      <div className="br-overlay-root">
        <div className="br-overlay-backdrop" onClick={props.onBackdropClose || props.onClose} />
        <div className="br-overlay-shell">
          <div className="br-overlay-dialog" onClick={(event) => event.stopPropagation()}>
            {content}
          </div>
        </div>
      </div>
    );
  }

  return content;
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return (
    <ReviewWorkspaceStoreProvider store={props.store}>
      <WorkspaceInner {...props} />
    </ReviewWorkspaceStoreProvider>
  );
}
