const STYLE_ID = 'babel-review-react-ui-style';

const STYLE_TEXT = `
  body {
    margin: 0;
    background: var(--br-bg);
    color: var(--br-ink);
    font: 13px/1.5 var(--br-font);
  }

  :root {
    color-scheme: light;
    --br-bg: #f5f5f5;
    --br-surface: #ffffff;
    --br-surface-muted: #fafafa;
    --br-ink: #1a1a1a;
    --br-muted: #737373;
    --br-faint: #a3a3a3;
    --br-line: #e5e5e5;
    --br-accent: #e8612d;
    --br-accent-soft: rgba(232, 97, 45, 0.08);
    --br-danger: #dc2626;
    --br-success: #16a34a;
    --br-radius: 8px;
    --br-radius-sm: 6px;
    --br-font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .br-page {
    min-height: 100vh;
    padding: 20px;
    background: var(--br-bg);
    color: var(--br-ink);
    font: 13px/1.5 var(--br-font);
  }

  .br-page-shell {
    max-width: 1040px;
    margin: 0 auto;
    display: grid;
    gap: 12px;
  }

  .br-shell-surface {
    background: var(--br-surface);
    border: 1px solid var(--br-line);
    border-radius: var(--br-radius);
  }

  .br-header-row,
  .br-toolbar,
  .br-row-top,
  .br-inline-actions,
  .br-suggestion-top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .br-header {
    padding: 10px 14px;
    border-bottom: 1px solid var(--br-line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .br-header-title {
    font-weight: 600;
    font-size: 13px;
  }

  .br-header-status {
    font-size: 12px;
    color: var(--br-muted);
  }

  .br-status {
    font-size: 12px;
    color: var(--br-muted);
  }

  .br-status[data-error="true"] {
    color: var(--br-danger);
  }

  .br-main {
    padding: 10px 14px 12px;
    display: grid;
    gap: 10px;
  }

  .br-summary-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--br-muted);
  }

  .br-summary-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .br-summary-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--br-accent);
  }

  .br-stack {
    display: grid;
    gap: 8px;
  }

  .br-card {
    border-top: 1px solid var(--br-line);
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .br-card:first-of-type {
    border-top: none;
  }

  .br-row-title {
    font-size: 13px;
    font-weight: 500;
  }

  .br-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    background: #f3f3f3;
    color: #525252;
  }

  .br-badge[data-variant="muted"] {
    background: #f3f3f3;
    color: #737373;
  }

  .br-badge[data-variant="warning"] {
    background: #fff7ed;
    color: #c2410c;
  }

  .br-badge[data-variant="success"] {
    background: #ecfdf3;
    color: #166534;
  }

  .br-pill-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--br-line);
  }

  .br-pill-dot[data-variant="matched"] {
    background: var(--br-success);
  }

  .br-pill-dot[data-variant="unmatched"] {
    background: var(--br-muted);
  }

  .br-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--br-faint);
  }

  .br-meta,
  .br-helper {
    font-size: 12px;
    color: var(--br-muted);
  }

  .br-textarea,
  .br-input,
  .br-select {
    width: 100%;
    border: 1px solid var(--br-line);
    border-radius: 6px;
    background: #fff;
    padding: 7px 9px;
    font: inherit;
    color: var(--br-ink);
  }

  .br-textarea {
    min-height: 80px;
    resize: vertical;
  }

  .br-input:focus,
  .br-textarea:focus,
  .br-select:focus {
    outline: none;
    border-color: var(--br-accent);
    box-shadow: 0 0 0 1px var(--br-accent-soft);
  }

  .br-button {
    border: 1px solid var(--br-line);
    border-radius: 6px;
    padding: 7px 12px;
    background: #ffffff;
    color: var(--br-ink);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .br-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .br-button[data-variant="primary"] {
    border-color: transparent;
    background: var(--br-accent);
    color: #ffffff;
  }

  .br-button[data-variant="danger"] {
    border-color: transparent;
    background: #fee2e2;
    color: var(--br-danger);
  }

  .br-button[data-variant="ghost"] {
    background: #ffffff;
  }

  .br-search-results,
  .br-suggestions {
    display: grid;
    gap: 8px;
  }

  .br-search-result {
    border: 1px solid var(--br-line);
    border-radius: 6px;
    background: #fff;
    padding: 8px;
  }

  .br-empty {
    border-radius: 6px;
    padding: 10px;
    background: var(--br-surface-muted);
    color: var(--br-muted);
    text-align: center;
    font-size: 12px;
  }

  .br-block {
    display: grid;
    gap: 6px;
    padding: 8px;
    border-radius: 6px;
    background: var(--br-surface-muted);
  }

  .br-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    font: 13px/1.5 var(--br-font);
  }

  .br-overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
  }

  .br-overlay-shell {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .br-overlay-dialog {
    width: min(960px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    overflow: auto;
    border-radius: 8px;
    background: transparent;
  }

  .br-section-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--br-faint);
  }

  .br-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .br-divider {
    height: 1px;
    background: var(--br-line);
  }

  .br-suggestion {
    padding: 8px 0;
    border-top: 1px solid var(--br-line);
  }

  .br-suggestion:first-of-type {
    border-top: none;
  }

  .br-suggestion-title {
    font-size: 13px;
    font-weight: 500;
  }

  @media (max-width: 720px) {
    .br-page {
      padding: 12px;
    }

    .br-overlay-shell {
      padding: 8px;
    }

    .br-overlay-dialog {
      width: calc(100vw - 16px);
      max-height: calc(100vh - 16px);
    }
  }
`;

export function ensureReviewUiStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT;
  document.documentElement.appendChild(style);
}
