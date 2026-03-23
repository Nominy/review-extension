import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ReviewSessionData, TemplateSearchResult } from '../core/types';

export type TemplateSearchState = {
  query: string;
  loading: boolean;
  error: string;
  results: TemplateSearchResult[];
};

export type ReviewWorkspaceState = {
  open: boolean;
  busy: boolean;
  loading: boolean;
  error: boolean;
  title: string;
  status: string;
  session: ReviewSessionData | null;
  sessionCommentDraft: string;
  cardCommentDrafts: Record<string, string>;
  expandedRows: Record<string, boolean>;
  templateSearch: Record<string, TemplateSearchState>;
  suggestionsExpanded: boolean;
  templateSearchOpen: Record<string, boolean>;
};

export type ReviewWorkspaceActions = {
  openLoading: (message: string, title?: string) => void;
  replaceSession: (session: ReviewSessionData, status?: string, resetUi?: boolean) => void;
  setBusy: (busy: boolean, status?: string) => void;
  setStatus: (message: string, isError?: boolean) => void;
  close: () => void;
  toggleExpandedRow: (cardId: string) => void;
  setExpandedRow: (cardId: string, expanded: boolean) => void;
  setSessionCommentDraft: (value: string) => void;
  setCardCommentDraft: (cardId: string, value: string) => void;
  setTemplateSearchState: (cardId: string, next: Partial<TemplateSearchState>) => void;
  clearTemplateSearchState: (cardId: string) => void;
  toggleSuggestionsExpanded: () => void;
  setTemplateSearchOpen: (cardId: string, open: boolean) => void;
};

export type ReviewWorkspaceStore = ReturnType<typeof createReviewWorkspaceStore>;

export const DEFAULT_TEMPLATE_SEARCH_STATE: TemplateSearchState = {
  query: '',
  loading: false,
  error: '',
  results: []
};

const ReviewWorkspaceStoreContext = createContext<ReviewWorkspaceStore | null>(null);

function commentsFromSession(session: ReviewSessionData | null): {
  sessionCommentDraft: string;
  cardCommentDrafts: Record<string, string>;
} {
  return {
    sessionCommentDraft: session?.comments?.sessionComment || '',
    cardCommentDrafts: { ...(session?.comments?.cardComments || {}) }
  };
}

export function createReviewWorkspaceStore() {
  return createStore<ReviewWorkspaceState & ReviewWorkspaceActions>((set) => ({
    open: false,
    busy: false,
    loading: false,
    error: false,
    title: 'Interactive Review',
    status: 'Ready.',
    session: null,
    sessionCommentDraft: '',
    cardCommentDrafts: {},
    expandedRows: {},
    templateSearch: {},
    suggestionsExpanded: true,
    templateSearchOpen: {},
    openLoading: (message, title = 'Interactive Review') =>
      set({
        open: true,
        busy: true,
        loading: true,
        error: false,
        title,
        status: message,
        session: null,
        sessionCommentDraft: '',
        cardCommentDrafts: {},
        expandedRows: {},
        templateSearch: {},
        suggestionsExpanded: true,
        templateSearchOpen: {}
      }),
    replaceSession: (session, status = 'Session ready.', resetUi = false) => {
      const nextComments = commentsFromSession(session);
      set((state) => ({
        open: true,
        busy: false,
        loading: false,
        error: false,
        title: 'Interactive Review',
        status,
        session,
        sessionCommentDraft: nextComments.sessionCommentDraft,
        cardCommentDrafts: nextComments.cardCommentDrafts,
        expandedRows: resetUi ? {} : state.expandedRows,
        templateSearch: resetUi ? {} : state.templateSearch,
        ...(resetUi ? { suggestionsExpanded: true, templateSearchOpen: {} } : {})
      }));
    },
    setBusy: (busy, status) =>
      set((state) => ({
        busy,
        ...(status ? { status } : {}),
        ...(busy ? {} : state.loading ? { loading: false } : {})
      })),
    setStatus: (message, isError = false) =>
      set((state) => ({
        status: message,
        error: isError,
        ...(isError ? { busy: false, loading: false } : {}),
        ...(isError ? {} : { open: state.open || !!state.session })
      })),
    close: () =>
      set({
        open: false,
        busy: false,
        loading: false,
        error: false,
        status: 'Ready.'
      }),
    toggleExpandedRow: (cardId) =>
      set((state) => ({
        expandedRows: {
          ...state.expandedRows,
          [cardId]: !state.expandedRows[cardId]
        }
      })),
    setExpandedRow: (cardId, expanded) =>
      set((state) => ({
        expandedRows: {
          ...state.expandedRows,
          [cardId]: expanded
        }
      })),
    setSessionCommentDraft: (value) => set({ sessionCommentDraft: value }),
    setCardCommentDraft: (cardId, value) =>
      set((state) => ({
        cardCommentDrafts: {
          ...state.cardCommentDrafts,
          [cardId]: value
        }
      })),
    setTemplateSearchState: (cardId, next) =>
      set((state) => ({
        templateSearch: {
          ...state.templateSearch,
          [cardId]: {
            ...(state.templateSearch[cardId] || DEFAULT_TEMPLATE_SEARCH_STATE),
            ...next
          }
        }
      })),
    clearTemplateSearchState: (cardId) =>
      set((state) => {
        const templateSearch = { ...state.templateSearch };
        delete templateSearch[cardId];
        return { templateSearch };
      }),
    toggleSuggestionsExpanded: () =>
      set((state) => ({
        suggestionsExpanded: !state.suggestionsExpanded
      })),
    setTemplateSearchOpen: (cardId, open) =>
      set((state) => ({
        templateSearchOpen: {
          ...state.templateSearchOpen,
          [cardId]: open
        }
      }))
  }));
}

export function ReviewWorkspaceStoreProvider(props: {
  store: ReviewWorkspaceStore;
  children: ReactNode;
}) {
  return (
    <ReviewWorkspaceStoreContext.Provider value={props.store}>
      {props.children}
    </ReviewWorkspaceStoreContext.Provider>
  );
}

export function useReviewWorkspaceSelector<T>(
  selector: (state: ReviewWorkspaceState & ReviewWorkspaceActions) => T
): T {
  const store = useContext(ReviewWorkspaceStoreContext);
  if (!store) {
    throw new Error('Review workspace store is missing.');
  }
  return useStore(store, selector);
}
