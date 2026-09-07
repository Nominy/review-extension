import { createReactComponents } from '@nominy/babel-extension-frontend';
import React, { memo, useEffect, useMemo, useState } from 'react';

const Ui = createReactComponents(React.createElement);
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
      <Ui.Diff as="div" className="br-diff-view">
        <Ui.DiffPane as="div" className="br-diff-pane">
          <Ui.DiffLabel as="div" className="br-diff-label">Before</Ui.DiffLabel>
          <Ui.DiffText as="div" className="br-diff-content">{evidence.before || '(empty)'}</Ui.DiffText>
        </Ui.DiffPane>
        <Ui.DiffPane as="div" className="br-diff-pane">
          <Ui.DiffLabel as="div" className="br-diff-label">After</Ui.DiffLabel>
          <Ui.DiffText as="div" className="br-diff-content">{evidence.after || '(empty)'}</Ui.DiffText>
          {evidence.inlineDiff ? <Ui.Meta as="div" className="br-meta" style={{marginTop: 4}}>{evidence.inlineDiff}</Ui.Meta> : null}
        </Ui.DiffPane>
      </Ui.Diff>
    );
  }

  return (
    <Ui.Card as="div" className="br-block">
      <Ui.Label as="div" className="br-label">Evidence</Ui.Label>
      <div style={{fontFamily: 'monospace', fontSize: '11px'}}>{evidence.text}</div>
    </Ui.Card>
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
      <Ui.Row as="div" className="br-inline-actions">
        <button
          className="br-button bui-button"
          data-size="sm"
          disabled={props.busy}
          onClick={props.onToggleOpen}
          type="button"
        >
          {props.card.matchedTemplateId ? 'Change template' : 'Match template'}
        </button>
      </Ui.Row>
    );
  }

  return (
    <Ui.Card as="div" className="br-block">
      <Ui.Label as="div" className="br-label">Template match</Ui.Label>
      <div className="br-body">
        <div><strong>{props.card.templateTitle || props.card.matchedTemplateId || 'No template selected'}</strong></div>
        <Ui.Meta as="div" className="br-meta">
          {describeMatchSource(props.card)}
          {props.card.matchedTemplateId ? ` · ${props.card.matchedTemplateId}` : ''}
        </Ui.Meta>
        {previousTemplate ? <Ui.Meta as="div" className="br-meta">Originally matched: {previousTemplate}</Ui.Meta> : null}
        
        <Ui.Stack as="div" className="br-stack" style={{marginTop: 8}}>
          <input
            id={`template-search-${props.cardId}`}
            className="br-input bui-input"
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
          {props.searchState.loading ? <Ui.Hint as="div" className="br-helper">Searching templates...</Ui.Hint> : null}
          {!props.searchState.loading && props.searchState.error ? (
            <Ui.Hint as="div" className="br-helper" style={{ color: 'var(--bui-danger)' }}>{props.searchState.error}</Ui.Hint>
          ) : null}
          {props.searchState.results.length ? (
            <Ui.Stack as="div" className="br-search-results" style={{maxHeight: '200px', overflowY: 'auto'}}>
              {props.searchState.results.map((result) => (
                <Ui.Card as="div" className="br-search-result" key={result.id}>
                  <Ui.Row as="div" className="br-row-top">
                    <Ui.Title as="div" className="br-row-title">{result.title}</Ui.Title>
                    <Ui.Badge as="span" className="br-badge" data-variant="warning">{result.category}</Ui.Badge>
                  </Ui.Row>
                  <Ui.Meta as="div" className="br-meta" style={{fontSize: '11px'}}>{result.description}</Ui.Meta>
                  <Ui.Row as="div" className="br-inline-actions" style={{marginTop: 4}}>
                    <button
                      className="br-button bui-button"
                      data-variant="primary"
                      data-size="sm"
                      disabled={props.busy}
                      onClick={() => props.onSelect(result.id)}
                      type="button"
                    >
                      Select
                    </button>
                  </Ui.Row>
                </Ui.Card>
              ))}
            </Ui.Stack>
          ) : !props.searchState.loading && props.searchState.query ? (
             <Ui.Hint as="div" className="br-helper">No results.</Ui.Hint>
          ) : null}
        </Ui.Stack>

        <Ui.Row as="div" className="br-inline-actions" style={{marginTop: 8}}>
          <button
            className="br-button bui-button"
            data-variant="danger"
            data-size="sm"
            disabled={props.busy || !props.card.matchedTemplateId}
            onClick={props.onClear}
            type="button"
          >
            Remove match
          </button>
          <button
            className="br-button bui-button"
            data-variant="ghost"
            data-size="sm"
            disabled={props.busy}
            onClick={props.onToggleOpen}
            type="button"
          >
            Cancel
          </button>
        </Ui.Row>
      </div>
    </Ui.Card>
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
    <Ui.Panel as="div" className="br-card">
      <div className="br-card-header" onClick={() => toggleExpandedRow(cardId)}>
        <Ui.Row as="div" className="br-row-top">
          <Ui.Row as="div" className="br-row-main">
            <Ui.Dot as="span" className="br-pill-dot" data-variant={props.card.matchedTemplateId ? 'matched' : 'unmatched'} />
            <Ui.Title as="div" className="br-row-title">
              #{props.card.changeIndex}: {deriveSummary(props.card)}
            </Ui.Title>
          </Ui.Row>
          <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
            {props.card.matchedTemplateId ? (
              <button
                className="br-button bui-button"
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
            <Ui.Badge as="span" className="br-badge" data-variant="warning">{props.card.type || 'UNKNOWN'}</Ui.Badge>
            <span style={{fontSize: '12px', color: 'var(--bui-faint)'}}>{expanded ? '▲' : '▼'}</span>
          </div>
        </Ui.Row>
        {!expanded && (
           <Ui.Meta as="div" className="br-meta" style={{paddingLeft: '16px'}}>
             {props.card.templateTitle || 'No template selected'}
           </Ui.Meta>
        )}
      </div>
      {expanded && (
        <Ui.Body as="div" className="br-card-body">
          {(props.card.opinionText || props.card.rationale) && (
            <Ui.Notice as="div" tone="warning" className="br-opinion-box">
              <Ui.Label as="div" className="br-label" style={{color: '#92400e', marginBottom: 2}}>System Opinion</Ui.Label>
              <div>{props.card.opinionText}</div>
              {props.card.rationale && <Ui.Hint as="div" className="br-opinion-rationale">{props.card.rationale}</Ui.Hint>}
            </Ui.Notice>
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

          <Ui.Card as="div" className="br-block">
            <Ui.Label as="div" className="br-label">Reviewer comment</Ui.Label>
            <textarea
              className="br-textarea bui-textarea"
              disabled={props.busy}
              onChange={(event) => {
                const value = event.target.value;
                setCardCommentDraft(cardId, value);
                props.onCommentChange(cardId, value);
              }}
              placeholder="Explain what should be different..."
              value={comment}
            />
          </Ui.Card>
        </Ui.Body>
      )}
    </Ui.Panel>
  );
});

const SuggestionsList = memo(function SuggestionsList(props: {
  busy: boolean;
  suggestions: ReviewSessionSuggestion[];
  onDecision: (proposalId: string, decision: 'approved' | 'rejected') => void;
}) {
  if (!props.suggestions.length) {
    return <Ui.Empty as="div" className="br-empty">No template suggestions yet.</Ui.Empty>;
  }

  return (
    <Ui.Stack as="div" className="br-suggestions">
      {props.suggestions.map((suggestion) => {
        const decision = suggestion.decision || 'pending';
        return (
          <Ui.Card as="div" className="br-suggestion" key={suggestion.proposalId}>
            <Ui.Row as="div" className="br-suggestion-top" style={{marginBottom: 8}}>
              <Ui.Badge as="span" className="br-badge" data-variant="primary">{suggestion.operation}</Ui.Badge>
              <Ui.Badge as="span" className="br-badge" data-variant="warning">{suggestion.category}</Ui.Badge>
              <Ui.Meta as="span" className="br-meta">{decision}</Ui.Meta>
            </Ui.Row>
            <Ui.Title as="div" className="br-suggestion-title">{suggestion.title || suggestion.targetTemplateId || 'Untitled suggestion'}</Ui.Title>
            {suggestion.description ? <div style={{marginTop: 4, fontSize: '12px'}}>{suggestion.description}</div> : null}
            <Ui.Meta as="div" className="br-meta" style={{marginTop: 4}}>Reason: {suggestion.reason}</Ui.Meta>
            {Array.isArray(suggestion.reportTexts) && suggestion.reportTexts.length ? (
              <Ui.Card as="div" className="br-block" style={{marginTop: 8}}>
                <Ui.Label as="div" className="br-label">Proposed text</Ui.Label>
                <div style={{fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre-wrap'}}>{suggestion.reportTexts.join('\n\n')}</div>
              </Ui.Card>
            ) : null}
            <Ui.Row as="div" className="br-inline-actions" style={{marginTop: 10}}>
              <button
                className="br-button bui-button"
                data-variant="primary"
                data-size="sm"
                disabled={props.busy || decision !== 'pending'}
                onClick={() => props.onDecision(suggestion.proposalId, 'approved')}
                type="button"
              >
                Approve
              </button>
              <button
                className="br-button bui-button"
                data-variant="danger"
                data-size="sm"
                disabled={props.busy || decision !== 'pending'}
                onClick={() => props.onDecision(suggestion.proposalId, 'rejected')}
                type="button"
              >
                Reject
              </button>
            </Ui.Row>
          </Ui.Card>
        );
      })}
    </Ui.Stack>
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

  if (!open) {
    return null;
  }

  const content = (
    <div>
      <Ui.PageShell as="div" className="br-page-shell">
        <Ui.Surface as="div" className="br-shell-surface">
          <Ui.Header as="div" className="br-header">
            <div>
              <Ui.Row as="div" className="br-header-title-row">
                <Ui.Title as="div" className="br-header-title">{title}</Ui.Title>
                <Ui.Link as="a"
                  className="br-support-link"
                  href="https://ko-fi.com/naftsan"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  if this extension saves you time, consider supporting development on Ko-Fi
                </Ui.Link>
              </Ui.Row>
              <Ui.Status as="div" className="br-header-status" data-error={error}>
                {status}
              </Ui.Status>
            </div>
            <Ui.Row as="div" className="br-toolbar">
              <button
                className="br-button bui-button"
                data-variant="ghost"
                disabled={busy || !session}
                onClick={() => props.onRefresh()}
                type="button"
              >
                Refresh
              </button>
              <button
                className="br-button bui-button"
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
                  className="br-button bui-button"
                  data-variant="ghost"
                  disabled={busy}
                  onClick={props.onClose}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </Ui.Row>
          </Ui.Header>

          <Ui.Body as="div" className="br-main">
            {loading || busy ? (
              <div className="bui-progress" data-indeterminate="true" role="progressbar" aria-label="Working">
                <div className="bui-progress-fill" />
              </div>
            ) : null}
            {loading && !session ? (
              <Ui.Empty as="div" className="br-empty">Preparing review session…</Ui.Empty>
            ) : null}

            {session ? (
              <>
                <Ui.Row as="div" className="br-summary-bar">
                  <Ui.Row as="div" className="br-summary-pill">
                    <Ui.Dot as="span" className="br-summary-dot" />
                    <span>{session.cards.length} changes</span>
                  </Ui.Row>
                  <span>·</span>
                  <span>{matchedCount} matched</span>
                  <span>·</span>
                  <span>{session.suggestions.length} suggestions</span>
                </Ui.Row>

                <Ui.Row as="div" className="br-toolbar-secondary" style={{marginTop: 4}}>
                  <div style={{display: 'flex', gap: '8px'}}>
                    <button
                      className="br-button bui-button"
                      data-size="sm"
                      onClick={() => toggleAllRows(true)}
                      type="button"
                    >
                      Expand All
                    </button>
                    <button
                      className="br-button bui-button"
                      data-size="sm"
                      onClick={() => toggleAllRows(false)}
                      type="button"
                    >
                      Collapse All
                    </button>
                  </div>
                  <button
                    className="br-button bui-button"
                    data-variant="ghost"
                    data-size="sm"
                    disabled={busy || !session}
                    onClick={() => props.onGenerateSuggestions()}
                    type="button"
                  >
                    Rescan for suggestions
                  </button>
                </Ui.Row>

                <Ui.Stack as="div" className="br-stack">
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
                    <Ui.Empty as="div" className="br-empty">No changes were detected for this review.</Ui.Empty>
                  )}
                </Ui.Stack>

                <Ui.Divider as="div" className="br-divider" style={{margin: '16px 0'}} />

                <section>
                  <Ui.Row as="div" className="br-section-header">
                    <Ui.Label as="div" className="br-section-title">Improve the system ({session.suggestions.length})</Ui.Label>
                    <button
                      className="br-button bui-button"
                      data-variant="ghost"
                      data-size="sm"
                      onClick={toggleSuggestionsExpanded}
                      type="button"
                    >
                      {suggestionsExpanded ? 'Hide' : 'Show'}
                    </button>
                  </Ui.Row>
                  {suggestionsExpanded ? (
                    <Ui.Stack as="div" className="br-stack">
                      <Ui.Card as="div" className="br-block">
                        <Ui.Label as="div" className="br-label">General reviewer comment</Ui.Label>
                        <textarea
                          className="br-textarea bui-textarea"
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSessionCommentDraft(value);
                            props.onSessionCommentChange(value);
                          }}
                          placeholder="Optional note for the entire review session..."
                          value={sessionCommentDraft}
                        />
                      </Ui.Card>
                      <SuggestionsList
                        busy={busy}
                        onDecision={props.onSuggestionDecision}
                        suggestions={session.suggestions || []}
                      />
                    </Ui.Stack>
                  ) : null}
                </section>
                
                <div style={{marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10}}>
                   <button
                    className="br-button bui-button"
                    disabled={busy || !session}
                    onClick={() => props.onFinalize('skip')}
                    type="button"
                  >
                    Apply without review
                  </button>
                  <button
                    className="br-button bui-button"
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
              <Ui.Empty as="div" className="br-empty">Session is not available.</Ui.Empty>
            ) : null}
          </Ui.Body>
        </Ui.Surface>
      </Ui.PageShell>
    </div>
  );

  return (
    <Ui.Overlay as="div" accent="orange" className="br-overlay-root">
      <div className="br-overlay-backdrop bui-backdrop" onClick={props.onBackdropClose || props.onClose} />
      <Ui.DialogPosition as="div" className="br-overlay-shell">
        <div className="br-overlay-dialog bui-dialog" onClick={(event) => event.stopPropagation()}>
          {content}
        </div>
      </Ui.DialogPosition>
    </Ui.Overlay>
  );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return (
    <ReviewWorkspaceStoreProvider store={props.store}>
      <WorkspaceInner {...props} />
    </ReviewWorkspaceStoreProvider>
  );
}
