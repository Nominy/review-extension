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
      <div className="br-diff-view">
        <div className="br-diff-pane">
          <div className="br-diff-label">Before</div>
          <div className="br-diff-content">{evidence.before || '(empty)'}</div>
        </div>
        <div className="br-diff-pane">
          <div className="br-diff-label">After</div>
          <div className="br-diff-content">{evidence.after || '(empty)'}</div>
          {evidence.inlineDiff ? <div className="br-meta" style={{marginTop: 4}}>{evidence.inlineDiff}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="br-block">
      <div className="br-label">Evidence</div>
      <div style={{fontFamily: 'monospace', fontSize: '11px'}}>{evidence.text}</div>
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
          data-size="sm"
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
        
        <div className="br-stack" style={{marginTop: 8}}>
          <input
            id={`template-search-${props.cardId}`}
            className="br-input"
            disabled={props.busy}
            onChange={(event) => {
              const value = event.target.value;
              setLocalQuery(value);
              props.onQueryChange(value);
            }}
            autoFocus
            placeholder="Search templates..."
            type="text"
            value={localQuery}
          />
          {props.searchState.loading ? <div className="br-helper">Searching templates...</div> : null}
          {!props.searchState.loading && props.searchState.error ? (
            <div className="br-helper" style={{ color: 'var(--br-danger)' }}>{props.searchState.error}</div>
          ) : null}
          {props.searchState.results.length ? (
            <div className="br-search-results" style={{maxHeight: '200px', overflowY: 'auto'}}>
              {props.searchState.results.map((result) => (
                <div className="br-search-result" key={result.id}>
                  <div className="br-row-top">
                    <div className="br-row-title">{result.title}</div>
                    <span className="br-badge" data-variant="warning">{result.category}</span>
                  </div>
                  <div className="br-meta" style={{fontSize: '11px'}}>{result.description}</div>
                  <div className="br-inline-actions" style={{marginTop: 4}}>
                    <button
                      className="br-button"
                      data-variant="primary"
                      data-size="sm"
                      disabled={props.busy}
                      onClick={() => props.onSelect(result.id)}
                      type="button"
                    >
                      Select
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : !props.searchState.loading && props.searchState.query ? (
             <div className="br-helper">No results.</div>
          ) : null}
        </div>

        <div className="br-inline-actions" style={{marginTop: 8}}>
          <button
            className="br-button"
            data-variant="danger"
            data-size="sm"
            disabled={props.busy || !props.card.matchedTemplateId}
            onClick={props.onClear}
            type="button"
          >
            Remove match
          </button>
          <button
            className="br-button"
            data-variant="ghost"
            data-size="sm"
            disabled={props.busy}
            onClick={props.onToggleOpen}
            type="button"
          >
            Cancel
          </button>
        </div>
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
  const toggleExpandedRow = useReviewWorkspaceSelector((state) => state.toggleExpandedRow);
  const setCardCommentDraft = useReviewWorkspaceSelector((state) => state.setCardCommentDraft);
  const setTemplateSearchOpen = useReviewWorkspaceSelector((state) => state.setTemplateSearchOpen);

  return (
    <div className="br-card">
      <div className="br-card-header" onClick={() => toggleExpandedRow(cardId)}>
        <div className="br-row-top">
          <div className="br-row-main">
            <span className="br-pill-dot" data-variant={props.card.matchedTemplateId ? 'matched' : 'unmatched'} />
            <div className="br-row-title">
              #{props.card.changeIndex}: {deriveSummary(props.card)}
            </div>
          </div>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
            {props.card.matchedTemplateId ? (
              <button
                className="br-button"
                data-variant="danger"
                data-size="sm"
                disabled={props.busy}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onTemplateClear(cardId);
                }}
                type="button"
              >
                Remove match
              </button>
            ) : null}
            <span className="br-badge" data-variant="warning">{props.card.type || 'UNKNOWN'}</span>
            <span style={{fontSize: '12px', color: 'var(--br-faint)'}}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
        {!expanded && (
           <div className="br-meta" style={{paddingLeft: '16px'}}>
             {props.card.templateTitle || 'No template selected'}
           </div>
        )}
      </div>
      {expanded && (
        <div className="br-card-body">
          {(props.card.opinionText || props.card.rationale) && (
            <div className="br-opinion-box">
              <div className="br-label" style={{color: '#92400e', marginBottom: 2}}>System Opinion</div>
              <div>{props.card.opinionText}</div>
              {props.card.rationale && <div className="br-opinion-rationale">{props.card.rationale}</div>}
            </div>
          )}

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
              placeholder="Explain what should be different..."
              value={comment}
            />
          </div>
        </div>
      )}
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
            <div className="br-suggestion-top" style={{marginBottom: 8}}>
              <span className="br-badge" data-variant="primary">{suggestion.operation}</span>
              <span className="br-badge" data-variant="warning">{suggestion.category}</span>
              <span className="br-meta">{decision}</span>
            </div>
            <div className="br-suggestion-title">{suggestion.title || suggestion.targetTemplateId || 'Untitled suggestion'}</div>
            {suggestion.description ? <div style={{marginTop: 4, fontSize: '12px'}}>{suggestion.description}</div> : null}
            <div className="br-meta" style={{marginTop: 4}}>Reason: {suggestion.reason}</div>
            {Array.isArray(suggestion.reportTexts) && suggestion.reportTexts.length ? (
              <div className="br-block" style={{marginTop: 8}}>
                <div className="br-label">Proposed text</div>
                <div style={{fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre-wrap'}}>{suggestion.reportTexts.join('\n\n')}</div>
              </div>
            ) : null}
            <div className="br-inline-actions" style={{marginTop: 10}}>
              <button
                className="br-button"
                data-variant="primary"
                data-size="sm"
                disabled={props.busy || decision !== 'pending'}
                onClick={() => props.onDecision(suggestion.proposalId, 'approved')}
                type="button"
              >
                Approve
              </button>
              <button
                className="br-button"
                data-variant="danger"
                data-size="sm"
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
  const toggleAllRows = useReviewWorkspaceSelector((state) => state.toggleAllRows);

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
                data-variant="ghost"
                disabled={busy || !session}
                onClick={() => props.onRefresh()}
                type="button"
              >
                Refresh
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

                <div className="br-toolbar-secondary" style={{marginTop: 4}}>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <button
                      className="br-button"
                      data-size="sm"
                      onClick={() => toggleAllRows(true)}
                      type="button"
                    >
                      Expand All
                    </button>
                    <button
                      className="br-button"
                      data-size="sm"
                      onClick={() => toggleAllRows(false)}
                      type="button"
                    >
                      Collapse All
                    </button>
                  </div>
                  <button
                    className="br-button"
                    data-variant="ghost"
                    data-size="sm"
                    disabled={busy || !session}
                    onClick={() => props.onGenerateSuggestions()}
                    type="button"
                  >
                    Rescan for suggestions
                  </button>
                </div>

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

                <div className="br-divider" style={{margin: '16px 0'}} />

                <section>
                  <div className="br-section-header">
                    <div className="br-section-title">Improve the system ({session.suggestions.length})</div>
                    <button
                      className="br-button"
                      data-variant="ghost"
                      data-size="sm"
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
                
                <div style={{marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10}}>
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
                    Apply & Sync
                  </button>
                </div>
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
