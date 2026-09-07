import { ensureUiStyles } from '@nominy/babel-extension-frontend';

// Review-specific arrangement only; all visual components come from shared UI.
const STYLE_ID = 'babel-review-react-ui-style';
export function ensureReviewUiStyles(): void {
  ensureUiStyles();
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .br-card-header { padding: 10px 12px; cursor: pointer; user-select: none; display: grid; gap: 4px; background: var(--bui-soft); }
    .br-card-header:hover { background: var(--bui-accent-soft); }
    .br-card-body { border-top: 1px solid var(--bui-line); }
    .br-row-top { align-items: flex-start; justify-content: space-between; }
    .br-row-main { flex: 1; min-width: 0; }
    .br-row-title { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .br-toolbar-secondary, .br-section-header { justify-content: space-between; }
    .br-support-link { font-size: 11px; }
    .br-readonly-value { overflow-wrap: anywhere; }
    .br-badge[data-variant="warning"] { color: var(--bui-warning); background: var(--bui-warning-soft); }
    .br-badge[data-variant="success"] { color: var(--bui-success); background: var(--bui-success-soft); }
    .br-pill-dot[data-variant="matched"] { background: var(--bui-success); }
    .br-pill-dot[data-variant="unmatched"] { background: var(--bui-muted); }
    .br-body { min-width: 0; }
  `;
  document.documentElement.appendChild(style);
}
