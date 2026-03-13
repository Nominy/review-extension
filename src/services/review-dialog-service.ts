import type {
  ReviewSessionComments,
  ReviewSessionData,
  ReviewSessionSuggestion
} from '../core/types';

const ROOT_ID = 'babel-review-dialog-root';
const STYLE_ID = 'babel-review-dialog-style';

type DialogTab = 'review' | 'improve';

type DialogHandlers = {
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onGenerateSuggestions: () => void | Promise<void>;
  onFinalize: (mode: 'apply' | 'skip') => void | Promise<void>;
  onCardCommentChange: (cardId: string, value: string) => void;
  onSessionCommentChange: (value: string) => void;
  onSuggestionDecision: (proposalId: string, decision: 'approved' | 'rejected') => void | Promise<void>;
};

type DialogState = {
  open: boolean;
  busy: boolean;
  loading: boolean;
  error: boolean;
  title: string;
  status: string;
  tab: DialogTab;
  session: ReviewSessionData | null;
  expandedRows: Set<string>;
  evidenceRows: Set<string>;
};

type ScrollSnapshot = {
  bodyTop: number;
  bodyLeft: number;
  panelTop: number;
  panelLeft: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Reset & root ───────────────────────────────────── */
    #${ROOT_ID}[hidden] { display: none !important; }
    #${ROOT_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #0f172a;
    }

    /* ── Backdrop ────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(8px) saturate(1.2);
      -webkit-backdrop-filter: blur(8px) saturate(1.2);
      animation: babel-dlg-backdrop-in 240ms ease-out both;
    }
    #${ROOT_ID}.babel-dlg-closing .babel-review-dialog-backdrop {
      animation: babel-dlg-backdrop-out 200ms ease-in both;
    }

    /* ── Panel ───────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-panel {
      position: relative;
      width: min(880px, calc(100vw - 48px));
      max-height: min(88vh, calc(100vh - 48px));
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.7);
      border-radius: 20px;
      box-shadow:
        0 0 0 1px rgba(15, 23, 42, 0.02),
        0 32px 100px -16px rgba(15, 23, 42, 0.22),
        0 12px 32px -8px rgba(15, 23, 42, 0.10),
        0 0 0 0.5px rgba(255, 255, 255, 0.8) inset;
      overflow: hidden;
      animation: babel-dlg-panel-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    #${ROOT_ID}.babel-dlg-closing .babel-review-dialog-panel {
      animation: babel-dlg-panel-out 200ms ease-in both;
    }

    /* ── Animations ──────────────────────────────────────── */
    @keyframes babel-dlg-backdrop-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    @keyframes babel-dlg-backdrop-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    @keyframes babel-dlg-panel-in {
      from { opacity: 0; transform: translateY(20px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes babel-dlg-panel-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(12px) scale(0.97); }
    }
    @keyframes babel-dlg-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes babel-dlg-pulse {
      0%, 100% { opacity: 0.45; }
      50% { opacity: 1; }
    }
    @keyframes babel-dlg-fade-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes babel-dlg-shimmer {
      0%, 100% { background-position: -200% 0; }
      50% { background-position: 200% 0; }
    }

    /* ── Header ──────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px 16px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.85);
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      position: relative;
    }
    #${ROOT_ID} .babel-review-dialog-header::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: -1px;
      height: 2px;
      background: linear-gradient(90deg, #6366f1 0%, #8b5cf6 40%, #a78bfa 70%, transparent 100%);
      opacity: 0.5;
    }
    #${ROOT_ID} .babel-review-dialog-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    #${ROOT_ID} .babel-review-dialog-title-icon {
      font-size: 22px;
      line-height: 1;
      filter: drop-shadow(0 1px 2px rgba(99, 102, 241, 0.2));
    }
    #${ROOT_ID} .babel-review-dialog-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #1e293b, #334155);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    #${ROOT_ID} .babel-review-dialog-subtitle {
      margin-top: 2px;
      font-size: 12px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
    }

    /* ── Header actions ──────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    /* ── Buttons ─────────────────────────────────────────── */
    #${ROOT_ID} button {
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 8px 14px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 160ms cubic-bezier(0.16, 1, 0.3, 1);
      line-height: 1.25;
      position: relative;
    }
    #${ROOT_ID} button:hover { transform: scale(1.015); }
    #${ROOT_ID} button:active { transform: scale(0.97); }
    #${ROOT_ID} button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
      filter: grayscale(0.25);
    }
    #${ROOT_ID} .primary-action {
      background: linear-gradient(135deg, #4f46e5, #4338ca);
      color: #ffffff;
      box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3), 0 1px 2px rgba(79, 70, 229, 0.15);
    }
    #${ROOT_ID} .primary-action:hover:not(:disabled) {
      background: linear-gradient(135deg, #5b52f0, #4f46e5);
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3), 0 2px 4px rgba(79, 70, 229, 0.15);
    }
    #${ROOT_ID} .secondary-action {
      background: #ffffff;
      color: #334155;
      border-color: rgba(203, 213, 225, 0.9);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${ROOT_ID} .secondary-action:hover:not(:disabled) {
      background: #f8fafc;
      border-color: rgba(148, 163, 184, 0.7);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
    }
    #${ROOT_ID} .close-action {
      width: 34px;
      min-width: 34px;
      height: 34px;
      padding: 0;
      border-radius: 10px;
      background: transparent;
      color: #94a3b8;
      border-color: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    #${ROOT_ID} .close-action:hover:not(:disabled) {
      background: rgba(241, 245, 249, 0.8);
      color: #475569;
      transform: none;
    }
    #${ROOT_ID} .close-action:active {
      transform: scale(0.92);
    }
    #${ROOT_ID} .close-action svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }
    #${ROOT_ID} .approve-action {
      background: linear-gradient(135deg, #ecfdf5, #d1fae5);
      color: #065f46;
      border-color: rgba(16, 185, 129, 0.25);
      box-shadow: 0 1px 2px rgba(16, 185, 129, 0.08);
    }
    #${ROOT_ID} .approve-action:hover:not(:disabled) {
      background: linear-gradient(135deg, #d1fae5, #a7f3d0);
      border-color: rgba(16, 185, 129, 0.4);
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.12);
    }
    #${ROOT_ID} .reject-action {
      background: linear-gradient(135deg, #fef2f2, #fee2e2);
      color: #991b1b;
      border-color: rgba(239, 68, 68, 0.2);
      box-shadow: 0 1px 2px rgba(239, 68, 68, 0.06);
    }
    #${ROOT_ID} .reject-action:hover:not(:disabled) {
      background: linear-gradient(135deg, #fee2e2, #fecaca);
      border-color: rgba(239, 68, 68, 0.35);
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);
    }

    /* ── Status bar ──────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-status {
      margin: 0;
      padding: 8px 24px;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: 0.01em;
    }
    #${ROOT_ID} .babel-review-dialog-status .babel-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      flex-shrink: 0;
      transition: background 200ms ease;
    }
    #${ROOT_ID} .babel-review-dialog-status[data-error="true"] {
      background: linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%);
      color: #991b1b;
      border-bottom-color: rgba(248, 113, 113, 0.25);
    }
    #${ROOT_ID} .babel-review-dialog-status[data-error="true"] .babel-status-dot {
      background: #ef4444;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);
    }
    #${ROOT_ID} .babel-review-dialog-status[data-busy="true"] .babel-status-dot {
      animation: babel-dlg-pulse 1.2s ease-in-out infinite;
      background: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
    }

    /* ── Tabs ────────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-tabs {
      display: flex;
      gap: 0;
      padding: 0 24px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.7);
      background: #ffffff;
    }
    #${ROOT_ID} .babel-review-tab {
      position: relative;
      border-radius: 0;
      padding: 12px 18px 13px;
      background: transparent;
      color: #64748b;
      border: none;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.01em;
      transition: color 150ms ease;
    }
    #${ROOT_ID} .babel-review-tab::after {
      content: '';
      position: absolute;
      left: 8px;
      right: 8px;
      bottom: -1px;
      height: 2px;
      border-radius: 2px 2px 0 0;
      background: transparent;
      transition: background 180ms ease, box-shadow 180ms ease;
    }
    #${ROOT_ID} .babel-review-tab:hover:not([data-active="true"]) {
      color: #334155;
      transform: none;
    }
    #${ROOT_ID} .babel-review-tab:active {
      transform: none;
    }
    #${ROOT_ID} .babel-review-tab[data-active="true"] {
      color: #4f46e5;
      transform: none;
    }
    #${ROOT_ID} .babel-review-tab[data-active="true"]::after {
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
    }
    #${ROOT_ID} .babel-review-tab .babel-tab-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 700;
      margin-left: 6px;
      background: #f1f5f9;
      color: #64748b;
      vertical-align: middle;
    }
    #${ROOT_ID} .babel-review-tab[data-active="true"] .babel-tab-count {
      background: rgba(99, 102, 241, 0.1);
      color: #4f46e5;
    }

    /* ── Body ────────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-body {
      overflow: auto;
      padding: 20px 24px 28px;
      display: grid;
      gap: 18px;
    }
    #${ROOT_ID} .babel-review-dialog-body::-webkit-scrollbar {
      width: 6px;
    }
    #${ROOT_ID} .babel-review-dialog-body::-webkit-scrollbar-track {
      background: transparent;
    }
    #${ROOT_ID} .babel-review-dialog-body::-webkit-scrollbar-thumb {
      background: rgba(148, 163, 184, 0.3);
      border-radius: 3px;
    }
    #${ROOT_ID} .babel-review-dialog-body::-webkit-scrollbar-thumb:hover {
      background: rgba(148, 163, 184, 0.5);
    }

    /* ── Panes ───────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-pane[hidden] { display: none !important; }
    #${ROOT_ID} .babel-review-pane-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    #${ROOT_ID} .babel-review-pane-title {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.01em;
    }
    #${ROOT_ID} .babel-review-pane-note {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 2px;
    }

    /* ── Row list & cards ────────────────────────────────── */
    #${ROOT_ID} .babel-review-row-list,
    #${ROOT_ID} .babel-review-suggestion-list {
      display: grid;
      gap: 10px;
    }
    #${ROOT_ID} .babel-review-row {
      border: 1px solid rgba(226, 232, 240, 0.85);
      border-radius: 14px;
      background: #ffffff;
      overflow: hidden;
      transition: border-color 180ms ease, box-shadow 180ms ease;
    }
    #${ROOT_ID} .babel-review-row:hover {
      border-color: rgba(203, 213, 225, 1);
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
    }
    #${ROOT_ID} .babel-review-row[open] {
      border-color: rgba(99, 102, 241, 0.22);
      box-shadow: 0 2px 16px rgba(99, 102, 241, 0.07), 0 0 0 1px rgba(99, 102, 241, 0.05);
    }
    #${ROOT_ID} .babel-review-row summary {
      list-style: none;
      cursor: pointer;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 13px 16px;
      user-select: none;
      -webkit-user-select: none;
      transition: background 120ms ease;
    }
    #${ROOT_ID} .babel-review-row summary::-webkit-details-marker { display: none; }
    #${ROOT_ID} .babel-review-row summary:hover {
      background: rgba(248, 250, 252, 0.7);
    }

    /* ── Badges ──────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: linear-gradient(135deg, #eff6ff, #e0e7ff);
      color: #3730a3;
    }
    #${ROOT_ID} .babel-review-badge[data-state="unmatched"] {
      background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
      color: #64748b;
    }
    #${ROOT_ID} .babel-review-badge[data-variant="operation"] {
      background: linear-gradient(135deg, #f5f3ff, #ede9fe);
      color: #5b21b6;
    }
    #${ROOT_ID} .babel-review-badge[data-variant="category"] {
      background: linear-gradient(135deg, #fef3c7, #fde68a);
      color: #92400e;
    }

    /* ── Row internals ───────────────────────────────────── */
    #${ROOT_ID} .babel-review-row-summary {
      min-width: 0;
    }
    #${ROOT_ID} .babel-review-row-title {
      font-weight: 600;
      color: #0f172a;
      font-size: 13.5px;
      line-height: 1.4;
    }
    #${ROOT_ID} .babel-review-row-meta {
      margin-top: 3px;
      font-size: 12px;
      color: #94a3b8;
    }
    #${ROOT_ID} .babel-review-row-chevron {
      color: #cbd5e1;
      transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), color 150ms ease;
      display: inline-flex;
      flex-shrink: 0;
    }
    #${ROOT_ID} .babel-review-row-chevron svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
    }
    #${ROOT_ID} .babel-review-row:hover .babel-review-row-chevron {
      color: #94a3b8;
    }
    #${ROOT_ID} .babel-review-row[open] .babel-review-row-chevron {
      transform: rotate(90deg);
      color: #6366f1;
    }

    /* ── Expanded content ────────────────────────────────── */
    #${ROOT_ID} .babel-review-row-content {
      padding: 0 16px 16px;
      display: grid;
      gap: 12px;
      border-top: 1px solid rgba(226, 232, 240, 0.55);
      background: linear-gradient(180deg, rgba(248, 250, 252, 0.8) 0%, #ffffff 100%);
      animation: babel-dlg-fade-in 180ms ease-out;
    }
    #${ROOT_ID} .babel-review-block {
      margin-top: 12px;
      border-radius: 10px;
      padding: 12px 14px;
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.8);
      overflow: visible;
      max-height: none;
    }
    #${ROOT_ID} .babel-review-block-title {
      margin-bottom: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    #${ROOT_ID} .babel-review-block-text {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: break-word;
      color: #334155;
      font-size: 13px;
      line-height: 1.6;
      max-height: none !important;
      overflow: visible !important;
      text-overflow: unset !important;
      -webkit-line-clamp: unset !important;
      -webkit-box-orient: unset !important;
      display: block !important;
    }

    /* ── Evidence (inline diff) ─────────────────────────── */
    #${ROOT_ID} .babel-review-evidence[hidden] { display: none !important; }
    #${ROOT_ID} .babel-review-evidence {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      animation: babel-dlg-fade-in 180ms ease-out;
    }
    #${ROOT_ID} .babel-review-evidence .babel-review-block[data-side="diff"] {
      border-color: rgba(99, 102, 241, 0.2);
      background: linear-gradient(180deg, #fafafe 0%, #ffffff 100%);
      overflow: visible;
      max-height: none;
    }
    #${ROOT_ID} .babel-review-evidence .babel-review-block[data-side="diff"] .babel-review-block-title {
      color: #6366f1;
    }

    /* ── Textareas ───────────────────────────────────────── */
    #${ROOT_ID} .babel-review-row textarea,
    #${ROOT_ID} .babel-review-pane textarea {
      width: 100%;
      min-height: 80px;
      border-radius: 10px;
      border: 1px solid rgba(203, 213, 225, 0.8);
      padding: 10px 12px;
      font: inherit;
      font-size: 13px;
      color: #0f172a;
      background: #ffffff;
      resize: vertical;
      transition: border-color 180ms ease, box-shadow 180ms ease;
    }
    #${ROOT_ID} .babel-review-row textarea:focus,
    #${ROOT_ID} .babel-review-pane textarea:focus {
      outline: none;
      border-color: rgba(99, 102, 241, 0.5);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08), 0 1px 2px rgba(99, 102, 241, 0.06);
    }
    #${ROOT_ID} .babel-review-row textarea::placeholder,
    #${ROOT_ID} .babel-review-pane textarea::placeholder {
      color: #cbd5e1;
    }

    /* ── Inline actions ──────────────────────────────────── */
    #${ROOT_ID} .babel-review-inline-actions {
      display: inline-flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    /* ── Suggestion cards ────────────────────────────────── */
    #${ROOT_ID} .babel-review-suggestion {
      border: 1px solid rgba(226, 232, 240, 0.85);
      border-radius: 14px;
      background: #ffffff;
      padding: 16px;
      display: grid;
      gap: 10px;
      transition: border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }
    #${ROOT_ID} .babel-review-suggestion:hover {
      border-color: rgba(203, 213, 225, 1);
      box-shadow: 0 3px 12px rgba(15, 23, 42, 0.05);
    }
    #${ROOT_ID} .babel-review-suggestion[data-decision="approved"] {
      border-color: rgba(16, 185, 129, 0.3);
      background: linear-gradient(180deg, #f0fdf9 0%, #ffffff 100%);
      box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.06);
    }
    #${ROOT_ID} .babel-review-suggestion[data-decision="rejected"] {
      border-color: rgba(239, 68, 68, 0.2);
      background: linear-gradient(180deg, #fef7f7 0%, #ffffff 100%);
      opacity: 0.65;
    }
    #${ROOT_ID} .babel-review-suggestion-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #${ROOT_ID} .babel-review-suggestion-title {
      font-weight: 700;
      font-size: 13.5px;
      color: #0f172a;
    }
    #${ROOT_ID} .babel-review-suggestion-meta,
    #${ROOT_ID} .babel-review-suggestion-reason {
      font-size: 12px;
      color: #94a3b8;
      line-height: 1.5;
    }
    #${ROOT_ID} .babel-review-suggestion-state {
      margin-left: auto;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 3px 9px;
      border-radius: 6px;
    }
    #${ROOT_ID} .babel-review-suggestion-state[data-decision="pending"] {
      color: #64748b;
      background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
    }
    #${ROOT_ID} .babel-review-suggestion-state[data-decision="approved"] {
      color: #065f46;
      background: linear-gradient(135deg, #ecfdf5, #d1fae5);
    }
    #${ROOT_ID} .babel-review-suggestion-state[data-decision="rejected"] {
      color: #991b1b;
      background: linear-gradient(135deg, #fef2f2, #fee2e2);
    }

    /* ── Empty / loading states ──────────────────────────── */
    #${ROOT_ID} .babel-review-empty {
      border: 1.5px dashed rgba(203, 213, 225, 0.6);
      border-radius: 14px;
      padding: 28px 20px;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      background: linear-gradient(180deg, #fafbfc 0%, #f8fafc 100%);
    }
    #${ROOT_ID} .babel-review-empty::before {
      content: '';
      display: block;
      width: 32px;
      height: 32px;
      margin: 0 auto 10px;
      border-radius: 8px;
      background: linear-gradient(135deg, #f1f5f9, #e2e8f0);
    }
    #${ROOT_ID} .babel-review-loading {
      padding: 48px 20px 44px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    #${ROOT_ID} .babel-review-loading-spinner {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2.5px solid rgba(99, 102, 241, 0.12);
      border-top-color: #6366f1;
      animation: babel-dlg-spin 0.75s linear infinite;
    }
    #${ROOT_ID} .babel-review-loading-text {
      font-weight: 500;
      letter-spacing: 0.01em;
    }

    /* ── Footer ──────────────────────────────────────────── */
    #${ROOT_ID} .babel-review-dialog-footer {
      padding: 12px 24px;
      border-top: 1px solid rgba(226, 232, 240, 0.5);
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }
    #${ROOT_ID} .babel-review-dialog-footer-hint {
      margin-right: auto;
      font-size: 11px;
      color: #94a3b8;
      letter-spacing: 0.01em;
    }
    #${ROOT_ID} .babel-review-dialog-footer-hint kbd {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid rgba(203, 213, 225, 0.7);
      background: #ffffff;
      font: inherit;
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.06);
    }

    /* ── Body lock ───────────────────────────────────────── */
    body[data-babel-review-dialog-open="true"] {
      overflow: hidden !important;
    }

    /* ── Responsive ──────────────────────────────────────── */
    @media (max-width: 720px) {
      #${ROOT_ID} {
        padding: 8px;
      }
      #${ROOT_ID} .babel-review-dialog-panel {
        width: calc(100vw - 16px);
        max-height: calc(100vh - 16px);
        border-radius: 16px;
      }
      #${ROOT_ID} .babel-review-dialog-header {
        align-items: flex-start;
        flex-direction: column;
        padding: 14px 18px 12px;
        gap: 12px;
      }
      #${ROOT_ID} .babel-review-dialog-actions {
        width: 100%;
        justify-content: flex-start;
      }
      #${ROOT_ID} .babel-review-dialog-body {
        padding: 14px 16px 20px;
      }
      #${ROOT_ID} .babel-review-dialog-status {
        padding: 8px 16px;
      }
      #${ROOT_ID} .babel-review-dialog-tabs {
        padding: 0 16px;
      }
      #${ROOT_ID} .babel-review-row summary {
        grid-template-columns: 1fr auto;
        padding: 12px 14px;
      }
      #${ROOT_ID} .babel-review-badge {
        grid-column: 1 / -1;
        justify-self: start;
      }
      #${ROOT_ID} .babel-review-dialog-footer {
        padding: 10px 16px;
        flex-wrap: wrap;
      }
      #${ROOT_ID} .babel-review-dialog-footer-hint {
        display: none;
      }
    }
  `;

  document.documentElement.appendChild(style);
}

function ensureRoot(): HTMLDivElement {
  let root: HTMLDivElement | null = document.getElementById(ROOT_ID) as HTMLDivElement | null;
  if (root instanceof HTMLDivElement) {
    return root;
  }

  root = document.createElement('div');
  root.id = ROOT_ID;
  root.hidden = true;
  document.documentElement.appendChild(root);
  return root;
}

function deriveSummary(card: ReviewSessionData['cards'][number]): string {
  if (card.summary && card.summary.trim()) {
    return card.summary.trim();
  }

  switch (card.type) {
    case 'TEXT':
      return 'Text changed';
    case 'TIMESTAMP':
      return 'Timestamp shift detected';
    case 'SEGMENTATION':
      return 'Segmentation changed';
    case 'WORD_DIFF':
      return 'Word-level difference detected';
    case 'TAG':
      return 'Tag usage changed';
    default:
      return card.description || 'Detected change';
  }
}

function deriveEvidence(card: ReviewSessionData['cards'][number]): string | null {
  const evidence = String(card.evidence || '').trim();
  if (evidence) {
    return evidence;
  }

  // Fallback: use description if it looks like a diff
  const description = String(card.description || '').trim();
  if (description) {
    return description;
  }

  return null;
}

function renderSuggestionList(suggestions: ReviewSessionSuggestion[], busy: boolean): string {
  if (!suggestions.length) {
    return '<div class="babel-review-empty">No template suggestions yet. Use the button above to generate them from reviewer comments.</div>';
  }

  return suggestions
    .map((suggestion) => {
      const decision = suggestion.decision || 'pending';
      const variants =
        Array.isArray(suggestion.reportTexts) && suggestion.reportTexts.length
          ? `<div class="babel-review-block"><div class="babel-review-block-title">Template text</div><div class="babel-review-block-text">${escapeHtml(
              suggestion.reportTexts.join('\n\n')
            )}</div></div>`
          : '';

      return [
        `<article class="babel-review-suggestion" data-decision="${escapeHtml(decision)}">`,
        '<div class="babel-review-suggestion-header">',
        `<span class="babel-review-badge" data-variant="operation">${escapeHtml(suggestion.operation)}</span>`,
        `<span class="babel-review-badge" data-variant="category">${escapeHtml(suggestion.category)}</span>`,
        `<span class="babel-review-suggestion-state" data-decision="${escapeHtml(decision)}">${escapeHtml(decision)}</span>`,
        '</div>',
        `<div class="babel-review-suggestion-title">${escapeHtml(
          suggestion.title || suggestion.targetTemplateId || 'Untitled suggestion'
        )}</div>`,
        suggestion.description
          ? `<div class="babel-review-block-text">${escapeHtml(suggestion.description)}</div>`
          : '',
        suggestion.reason
          ? `<div class="babel-review-suggestion-reason">${escapeHtml(suggestion.reason)}</div>`
          : '',
        `<div class="babel-review-suggestion-meta">Source cards: ${escapeHtml(
          (suggestion.sourceCardIds || []).join(', ') || 'n/a'
        )}</div>`,
        variants,
        '<div class="babel-review-inline-actions">',
        `<button class="approve-action" data-action="approve-suggestion" data-proposal-id="${escapeHtml(
          suggestion.proposalId
        )}" ${busy || decision !== 'pending' ? 'disabled' : ''}>Approve</button>`,
        `<button class="reject-action" data-action="reject-suggestion" data-proposal-id="${escapeHtml(
          suggestion.proposalId
        )}" ${busy || decision !== 'pending' ? 'disabled' : ''}>Reject</button>`,
        '</div>',
        '</article>'
      ].join('');
    })
    .join('');
}

function buildMarkup(state: DialogState): string {
  const session = state.session;
  const reviewRows = session?.cards || [];
  const comments: ReviewSessionComments = session?.comments || {
    sessionComment: '',
    cardComments: {}
  };

  const chevronSvg = '<svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const closeSvg = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const cardCount = reviewRows.length;
  const matchedCount = reviewRows.filter((c) => !!c.matchedTemplateId).length;

  const reviewMarkup = cardCount
    ? reviewRows
        .map((card) => {
          const cardId = String(card.id || card.changeIndex);
          const evidence = deriveEvidence(card);
          const isMatched = !!card.matchedTemplateId;
          const isOpen = state.expandedRows.has(cardId);
          const evidenceOpen = state.evidenceRows.has(cardId);

          return [
            `<details class="babel-review-row" data-card-row="${escapeHtml(cardId)}" ${isOpen ? 'open' : ''}>`,
            '<summary>',
            `<span class="babel-review-badge" data-state="${isMatched ? 'matched' : 'unmatched'}">${
              isMatched ? 'Matched' : 'Unmatched'
            }</span>`,
            '<span class="babel-review-row-summary">',
            `<div class="babel-review-row-title">Change ${escapeHtml(card.changeIndex)}: ${escapeHtml(
              deriveSummary(card)
            )}</div>`,
            `<div class="babel-review-row-meta">${escapeHtml(
              card.templateTitle || (isMatched ? 'System opinion available' : 'No system issue selected')
            )}</div>`,
            '</span>',
            `<span class="babel-review-row-chevron">${chevronSvg}</span>`,
            '</summary>',
            '<div class="babel-review-row-content">',
            '<div class="babel-review-block">',
            '<div class="babel-review-block-title">System opinion</div>',
            `<div class="babel-review-block-text">${escapeHtml(
              card.opinionText || 'No system issue selected for this change.'
            )}</div>`,
            card.rationale
              ? `<div class="babel-review-row-meta" style="margin-top:8px;">${escapeHtml(card.rationale)}</div>`
              : '',
            '</div>',
            evidence
              ? [
                  '<div class="babel-review-inline-actions">',
                  `<button class="secondary-action" data-action="toggle-evidence" data-card-id="${escapeHtml(cardId)}">${
                    evidenceOpen ? 'Hide evidence' : 'Show evidence'
                  }</button>`,
                  '</div>',
                  `<div class="babel-review-evidence" data-evidence-id="${escapeHtml(cardId)}" ${
                    evidenceOpen ? '' : 'hidden'
                  }>`,
                  `<div class="babel-review-block" data-side="diff"><div class="babel-review-block-title">Evidence (what the LLM saw)</div><div class="babel-review-block-text">${escapeHtml(
                    evidence
                  )}</div></div>`,
                  '</div>'
                ].join('')
              : '',
            '<div class="babel-review-block">',
            '<div class="babel-review-block-title">Reviewer comment</div>',
            `<textarea data-card-id="${escapeHtml(cardId)}" placeholder="Tell the system what should be improved for this change\u2026" ${
              state.busy ? 'disabled' : ''
            }>${escapeHtml(comments.cardComments[cardId] || '')}</textarea>`,
            '</div>',
            '</div>',
            '</details>'
          ].join('');
        })
        .join('')
    : '<div class="babel-review-empty">No changes were detected for this review.</div>';

  const improveMarkup = [
    '<div class="babel-review-pane-head">',
    '<div>',
    '<div class="babel-review-pane-title">Improve the system</div>',
    '<div class="babel-review-pane-note">Use explicit reviewer comments to generate template suggestions.</div>',
    '</div>',
    `<button class="secondary-action" data-action="generate-suggestions" ${state.busy || !session ? 'disabled' : ''}>Generate suggestions</button>`,
    '</div>',
    '<div class="babel-review-block">',
    '<div class="babel-review-block-title">General reviewer comment</div>',
    `<textarea data-role="session-comment" placeholder="Optional overall note for this review session\u2026" ${
      state.busy ? 'disabled' : ''
    }>${escapeHtml(comments.sessionComment || '')}</textarea>`,
    '</div>',
    `<div class="babel-review-suggestion-list">${renderSuggestionList(session?.suggestions || [], state.busy)}</div>`
  ].join('');

  const tabBadge = (count: number): string =>
    count > 0 ? `<span class="babel-tab-count">${count}</span>` : '';

  const bodyMarkup = state.loading
    ? [
        '<div class="babel-review-loading">',
        '<div class="babel-review-loading-spinner"></div>',
        `<div class="babel-review-loading-text">${escapeHtml(state.status || 'Preparing review\u2026')}</div>`,
        '</div>'
      ].join('')
    : [
        '<div class="babel-review-dialog-tabs">',
        `<button class="babel-review-tab" data-tab="review" data-active="${state.tab === 'review'}">Review${tabBadge(cardCount)}</button>`,
        `<button class="babel-review-tab" data-tab="improve" data-active="${state.tab === 'improve'}">Improve${tabBadge(session?.suggestions?.length || 0)}</button>`,
        '</div>',
        '<div class="babel-review-dialog-body">',
        `<section class="babel-review-pane" data-pane="review" ${state.tab === 'review' ? '' : 'hidden'}>`,
        '<div class="babel-review-pane-head">',
        '<div>',
        `<div class="babel-review-pane-title">Detected changes</div>`,
        `<div class="babel-review-pane-note">${cardCount} change${cardCount !== 1 ? 's' : ''} detected \u00b7 ${matchedCount} matched</div>`,
        '</div>',
        `<button class="secondary-action" data-action="refresh-session" ${state.busy || !session ? 'disabled' : ''}>Refresh</button>`,
        '</div>',
        `<div class="babel-review-row-list">${reviewMarkup}</div>`,
        '</section>',
        `<section class="babel-review-pane" data-pane="improve" ${state.tab === 'improve' ? '' : 'hidden'}>`,
        improveMarkup,
        '</section>',
        '</div>'
      ].join('');

  return [
    '<div class="babel-review-dialog-backdrop" data-action="close"></div>',
    '<section class="babel-review-dialog-panel" role="dialog" aria-modal="true" aria-label="Interactive review dialog">',
    '<header class="babel-review-dialog-header">',
    '<div>',
    '<div class="babel-review-dialog-title-row">',
    '<span class="babel-review-dialog-title-icon">\u{1FA84}</span>',
    `<span class="babel-review-dialog-title">${escapeHtml(state.title)}</span>`,
    '</div>',
    session?.sessionId
      ? `<div class="babel-review-dialog-subtitle">Session ${escapeHtml(session.sessionId)}</div>`
      : '',
    '</div>',
    '<div class="babel-review-dialog-actions">',
    `<button class="secondary-action" data-action="finalize-skip" ${state.busy || !session ? 'disabled' : ''}>Apply immediately</button>`,
    `<button class="primary-action" data-action="finalize-apply" ${state.busy || !session ? 'disabled' : ''}>Apply final review</button>`,
    `<button class="close-action" data-action="close" aria-label="Close review dialog">${closeSvg}</button>`,
    '</div>',
    '</header>',
    `<div class="babel-review-dialog-status" data-error="${state.error}" data-busy="${state.busy}"><span class="babel-status-dot"></span>${escapeHtml(state.status)}</div>`,
    bodyMarkup,
    !state.loading ? [
      '<footer class="babel-review-dialog-footer">',
      '<span class="babel-review-dialog-footer-hint"><kbd>Esc</kbd> to close</span>',
      '</footer>'
    ].join('') : '',
    '</section>'
  ].join('');
}

export function createReviewDialogService() {
  const state: DialogState = {
    open: false,
    busy: false,
    loading: false,
    error: false,
    title: 'Interactive Review',
    status: 'Ready.',
    tab: 'review',
    session: null,
    expandedRows: new Set<string>(),
    evidenceRows: new Set<string>()
  };

  let handlers: DialogHandlers | null = null;

  function captureScroll(root: HTMLDivElement): ScrollSnapshot {
    const body = root.querySelector<HTMLElement>('.babel-review-dialog-body');
    const panel = root.querySelector<HTMLElement>('.babel-review-dialog-panel');
    return {
      bodyTop: body?.scrollTop || 0,
      bodyLeft: body?.scrollLeft || 0,
      panelTop: panel?.scrollTop || 0,
      panelLeft: panel?.scrollLeft || 0
    };
  }

  function restoreScroll(root: HTMLDivElement, snapshot: ScrollSnapshot): void {
    const body = root.querySelector<HTMLElement>('.babel-review-dialog-body');
    if (body) {
      body.scrollTop = snapshot.bodyTop;
      body.scrollLeft = snapshot.bodyLeft;
    }

    const panel = root.querySelector<HTMLElement>('.babel-review-dialog-panel');
    if (panel) {
      panel.scrollTop = snapshot.panelTop;
      panel.scrollLeft = snapshot.panelLeft;
    }
  }

  function render(): void {
    const root = ensureRoot();
    const scroll = captureScroll(root);
    root.hidden = !state.open;
    root.innerHTML = state.open ? buildMarkup(state) : '';
    if (state.open) {
      restoreScroll(root, scroll);
    }
  }

  /* ── Surgical DOM patching (no full innerHTML rebuild) ── */

  /** Returns true if the dialog is open with content (not in loading state). */
  function canPatch(): boolean {
    if (!state.open || state.loading) {
      return false;
    }
    const root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    return !!root && !!root.querySelector('.babel-review-dialog-status');
  }

  /** Patch just the status bar text + data attributes. */
  function patchStatusBar(): void {
    const root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (!root) {
      return;
    }
    const statusEl = root.querySelector<HTMLElement>('.babel-review-dialog-status');
    if (!statusEl) {
      return;
    }
    statusEl.dataset.error = String(state.error);
    statusEl.dataset.busy = String(state.busy);
    // Keep the dot span, replace text
    const dot = statusEl.querySelector('.babel-status-dot');
    statusEl.textContent = '';
    if (dot) {
      statusEl.appendChild(dot);
    } else {
      const newDot = document.createElement('span');
      newDot.className = 'babel-status-dot';
      statusEl.appendChild(newDot);
    }
    statusEl.appendChild(document.createTextNode(state.status));
  }

  /** Toggle disabled state on all interactive elements (buttons, textareas). */
  function patchBusyState(): void {
    const root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (!root) {
      return;
    }

    // Action buttons in the header and pane heads
    const actionBtns = Array.from(root.querySelectorAll<HTMLButtonElement>(
      '[data-action="finalize-skip"], [data-action="finalize-apply"], ' +
      '[data-action="refresh-session"], [data-action="generate-suggestions"], ' +
      '[data-action="approve-suggestion"], [data-action="reject-suggestion"]'
    ));
    for (const btn of actionBtns) {
      // Suggestion buttons: disabled if busy OR not pending
      const action = btn.dataset.action || '';
      if (action === 'approve-suggestion' || action === 'reject-suggestion') {
        const article = btn.closest<HTMLElement>('.babel-review-suggestion');
        const decision = article?.dataset.decision || 'pending';
        btn.disabled = state.busy || decision !== 'pending';
      } else {
        btn.disabled = state.busy || !state.session;
      }
    }

    // Textareas
    const textareas = Array.from(root.querySelectorAll<HTMLTextAreaElement>(
      '.babel-review-row textarea, .babel-review-pane textarea'
    ));
    for (const ta of textareas) {
      ta.disabled = state.busy;
    }
  }

  /** Rebuild only the suggestion list inside the Improve pane. */
  function patchSuggestionList(): void {
    const root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (!root) {
      return;
    }
    const listEl = root.querySelector<HTMLElement>('.babel-review-suggestion-list');
    if (listEl) {
      listEl.innerHTML = renderSuggestionList(state.session?.suggestions || [], state.busy);
    }
    // Update tab badge counts
    const tabs = Array.from(root.querySelectorAll<HTMLElement>('.babel-review-tab'));
    for (const tab of tabs) {
      const tabName = tab.dataset.tab;
      let count = 0;
      if (tabName === 'review') {
        count = state.session?.cards?.length || 0;
      } else if (tabName === 'improve') {
        count = state.session?.suggestions?.length || 0;
      }
      const badge = tab.querySelector('.babel-tab-count');
      if (count > 0) {
        if (badge) {
          badge.textContent = String(count);
        } else {
          const newBadge = document.createElement('span');
          newBadge.className = 'babel-tab-count';
          newBadge.textContent = String(count);
          tab.appendChild(newBadge);
        }
      } else if (badge) {
        badge.remove();
      }
    }
  }

  function open(): void {
    ensureStyles();
    state.open = true;
    document.body.dataset.babelReviewDialogOpen = 'true';
    render();
  }

  function close(): void {
    const root = document.getElementById(ROOT_ID) as HTMLDivElement | null;
    if (root && state.open) {
      root.classList.add('babel-dlg-closing');
      const onEnd = (): void => {
        root.removeEventListener('animationend', onEnd);
        root.classList.remove('babel-dlg-closing');
        state.open = false;
        delete document.body.dataset.babelReviewDialogOpen;
        render();
      };
      root.addEventListener('animationend', onEnd);
      // Fallback in case animationend doesn't fire
      window.setTimeout(onEnd, 250);
    } else {
      state.open = false;
      delete document.body.dataset.babelReviewDialogOpen;
      render();
    }
  }

  function syncLocalComment(cardId: string, value: string): void {
    if (!state.session) {
      return;
    }

    if (!state.session.comments) {
      state.session.comments = { sessionComment: '', cardComments: {} };
    }

    if (value.trim()) {
      state.session.comments.cardComments[cardId] = value;
    } else {
      delete state.session.comments.cardComments[cardId];
    }
  }

  function syncSessionComment(value: string): void {
    if (!state.session) {
      return;
    }

    if (!state.session.comments) {
      state.session.comments = { sessionComment: '', cardComments: {} };
    }

    state.session.comments.sessionComment = value;
  }

  function ensureBound(nextHandlers: DialogHandlers): void {
    handlers = nextHandlers;
    ensureStyles();
    const root = ensureRoot();
    if (root.dataset.bound === 'true') {
      return;
    }

    root.dataset.bound = 'true';

    root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !handlers) {
        return;
      }

      const summary = target.closest<HTMLElement>('summary');
      const summaryRow = summary?.closest<HTMLDetailsElement>('.babel-review-row') || null;
      if (summaryRow) {
        const rowId = summaryRow.dataset.cardRow || '';
        window.setTimeout(() => {
          if (!rowId) {
            return;
          }
          if (summaryRow.open) {
            state.expandedRows.add(rowId);
          } else {
            state.expandedRows.delete(rowId);
          }
        }, 0);
      }

      const actionElement = target.closest<HTMLElement>('[data-action]') || null;
      const action = actionElement?.dataset.action || '';
      const tab = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as DialogTab | undefined;

      if (tab) {
        state.tab = tab;
        // Lightweight DOM-level tab switch — no full re-render
        const allTabs = Array.from(root.querySelectorAll<HTMLElement>('.babel-review-tab'));
        for (const t of allTabs) {
          t.dataset.active = String(t.dataset.tab === tab);
        }
        const allPanes = Array.from(root.querySelectorAll<HTMLElement>('.babel-review-pane'));
        for (const p of allPanes) {
          p.hidden = p.dataset.pane !== tab;
        }
        // Reset scroll to top when switching tabs
        const body = root.querySelector<HTMLElement>('.babel-review-dialog-body');
        if (body) {
          body.scrollTop = 0;
        }
        return;
      }

      switch (action) {
        case 'close':
          handlers.onClose();
          return;
        case 'refresh-session':
          void handlers.onRefresh();
          return;
        case 'generate-suggestions':
          void handlers.onGenerateSuggestions();
          return;
        case 'finalize-skip':
          void handlers.onFinalize('skip');
          return;
        case 'finalize-apply':
          void handlers.onFinalize('apply');
          return;
        case 'approve-suggestion': {
          const proposalId = target.closest<HTMLElement>('[data-proposal-id]')?.dataset.proposalId || '';
          if (proposalId) {
            void handlers.onSuggestionDecision(proposalId, 'approved');
          }
          return;
        }
        case 'reject-suggestion': {
          const proposalId = target.closest<HTMLElement>('[data-proposal-id]')?.dataset.proposalId || '';
          if (proposalId) {
            void handlers.onSuggestionDecision(proposalId, 'rejected');
          }
          return;
        }
        case 'toggle-evidence': {
          const cardId = actionElement?.dataset.cardId || '';
          if (!cardId) {
            return;
          }

          const rowId = target.closest<HTMLDetailsElement>('.babel-review-row')?.dataset.cardRow || cardId;
          if (rowId) {
            state.expandedRows.add(rowId);
          }

          if (state.evidenceRows.has(cardId)) {
            state.evidenceRows.delete(cardId);
          } else {
            state.evidenceRows.add(cardId);
          }

          const evidence = root.querySelector<HTMLElement>(`[data-evidence-id="${CSS.escape(cardId)}"]`);
          if (evidence) {
            evidence.hidden = !state.evidenceRows.has(cardId);
          }
          if (actionElement instanceof HTMLButtonElement) {
            actionElement.textContent = state.evidenceRows.has(cardId) ? 'Hide evidence' : 'Show evidence';
          }
          return;
        }
        default:
          return;
      }
    });

    root.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !handlers) {
        return;
      }

      const cardId = target.dataset.cardId || '';
      if (cardId) {
        syncLocalComment(cardId, target.value || '');
        handlers.onCardCommentChange(cardId, target.value || '');
        return;
      }

      if (target.dataset.role === 'session-comment') {
        syncSessionComment(target.value || '');
        handlers.onSessionCommentChange(target.value || '');
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open && handlers) {
        handlers.onClose();
      }
    });
  }

  return {
    mount(nextHandlers: DialogHandlers): void {
      ensureBound(nextHandlers);
    },
    openLoading(message: string, title = 'Interactive Review'): void {
      state.title = title;
      state.status = message;
      state.error = false;
      state.loading = true;
      state.busy = true;
      state.session = null;
      state.tab = 'review';
      state.expandedRows.clear();
      state.evidenceRows.clear();
      open();
    },
    renderSession(session: ReviewSessionData, status = 'Session ready.'): void {
      const wasLoading = state.loading;
      state.session = session;
      state.title = 'Interactive Review';
      state.status = status;
      state.error = false;
      state.loading = false;
      state.busy = false;

      // First render after loading → must do a full rebuild to swap
      // from the loading spinner to the tabbed content layout.
      if (wasLoading || !canPatch()) {
        open();
        return;
      }

      // Surgical: update status bar, suggestion list, busy/disabled,
      // and tab badges — without touching scroll, expanded rows, or
      // textarea content.
      patchStatusBar();
      patchSuggestionList();
      patchBusyState();
    },
    setBusy(nextBusy: boolean, status?: string): void {
      state.busy = nextBusy;
      if (status) {
        state.status = status;
      }

      if (canPatch()) {
        patchStatusBar();
        patchBusyState();
        return;
      }
      render();
    },
    setStatus(message: string, isError = false): void {
      state.status = message;
      state.error = isError;
      if (isError) {
        state.loading = false;
        state.busy = false;
      }

      if (canPatch()) {
        patchStatusBar();
        if (isError) {
          patchBusyState();
        }
        return;
      }
      render();
    },
    close(): void {
      close();
    },
    isOpen(): boolean {
      return state.open;
    }
  };
}
