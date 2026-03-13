import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReviewSessionData } from '../core/types';
import { ReviewWorkspace } from '../ui/review-workspace';
import { ensureReviewUiStyles } from '../ui/styles';
import { createReviewWorkspaceStore, type TemplateSearchState } from '../ui/review-workspace-store';

const ROOT_ID = 'babel-review-react-root';

type DialogHandlers = {
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onGenerateSuggestions: () => void | Promise<void>;
  onFinalize: (mode: 'apply' | 'skip') => void | Promise<void>;
  onCardCommentChange: (cardId: string, value: string) => void;
  onTemplateSearch: (cardId: string, query: string) => void;
  onTemplateSelect: (cardId: string, templateId: string) => void | Promise<void>;
  onTemplateClear: (cardId: string) => void | Promise<void>;
  onSessionCommentChange: (value: string) => void;
  onSuggestionDecision: (proposalId: string, decision: 'approved' | 'rejected') => void | Promise<void>;
};

function ensureRoot(): HTMLDivElement {
  let root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (root) {
    return root;
  }

  root = document.createElement('div');
  root.id = ROOT_ID;
  document.documentElement.appendChild(root);
  return root;
}

export function createReviewDialogService() {
  const store = createReviewWorkspaceStore();
  let root: Root | null = null;
  let handlers: DialogHandlers | null = null;

  function ensureMounted(): void {
    ensureReviewUiStyles();
    if (!root) {
      root = createRoot(ensureRoot());
    }

    if (!handlers) {
      return;
    }

    root.render(
      <ReviewWorkspace
        closeLabel="Close"
        onCardCommentChange={(cardId, value) => handlers?.onCardCommentChange(cardId, value)}
        onClose={() => handlers?.onClose()}
        onFinalize={(mode) => handlers?.onFinalize(mode)}
        onGenerateSuggestions={() => handlers?.onGenerateSuggestions()}
        onRefresh={() => handlers?.onRefresh()}
        onSessionCommentChange={(value) => handlers?.onSessionCommentChange(value)}
        onSuggestionDecision={(proposalId, decision) => handlers?.onSuggestionDecision(proposalId, decision)}
        onTemplateClear={(cardId) => handlers?.onTemplateClear(cardId)}
        onTemplateSearchChange={(cardId, query) => handlers?.onTemplateSearch(cardId, query)}
        onTemplateSelect={(cardId, templateId) => handlers?.onTemplateSelect(cardId, templateId)}
        store={store}
        variant="overlay"
      />
    );
  }

  function bindEscapeKey(): void {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && store.getState().open) {
        handlers?.onClose();
      }
    });
  }

  bindEscapeKey();

  return {
    mount(nextHandlers: DialogHandlers): void {
      handlers = nextHandlers;
      ensureMounted();
    },
    openLoading(message: string, title = 'Interactive Review'): void {
      ensureMounted();
      store.getState().openLoading(message, title);
    },
    renderSession(session: ReviewSessionData, status = 'Session ready.'): void {
      ensureMounted();
      store.getState().replaceSession(session, status);
    },
    setBusy(nextBusy: boolean, status?: string): void {
      store.getState().setBusy(nextBusy, status);
    },
    setStatus(message: string, isError = false): void {
      store.getState().setStatus(message, isError);
    },
    setTemplateSearchState(
      cardId: string,
      next: Partial<TemplateSearchState>
    ): void {
      store.getState().setTemplateSearchState(cardId, next);
    },
    clearTemplateSearchState(cardId: string): void {
      store.getState().clearTemplateSearchState(cardId);
    },
    close(): void {
      store.getState().close();
    },
    isOpen(): boolean {
      return store.getState().open;
    }
  };
}
