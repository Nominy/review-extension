const STYLE_ID = 'babel-review-react-ui-style';

const STYLE_TEXT = `
  body {
    margin: 0;
    background: var(--br-bg);
    color: var(--br-ink);
    font: 14px/1.55 var(--br-font);
  }

  :root {
    color-scheme: light;
    --br-bg: #f4f7fb;
    --br-surface: #ffffff;
    --br-surface-muted: #f8fafc;
    --br-ink: #0f172a;
    --br-muted: #64748b;
    --br-faint: #94a3b8;
    --br-line: rgba(226, 232, 240, 0.9);
    --br-accent: #1d4ed8;
    --br-accent-soft: rgba(29, 78, 216, 0.08);
    --br-danger: #dc2626;
    --br-success: #059669;
    --br-shadow: 0 18px 48px -18px rgba(15, 23, 42, 0.24);
    --br-radius: 16px;
    --br-radius-sm: 10px;
    --br-font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .br-page {
    min-height: 100vh;
    padding: 24px;
    background: radial-gradient(circle at top, #dbeafe 0%, #eff6ff 28%, var(--br-bg) 62%);
    color: var(--br-ink);
    font: 14px/1.55 var(--br-font);
  }

  .br-page-shell {
    max-width: 1100px;
    margin: 0 auto;
    display: grid;
    gap: 16px;
  }

  .br-panel,
  .br-hero,
  .br-card,
  .br-suggestion {
    background: var(--br-surface);
    border: 1px solid var(--br-line);
    border-radius: var(--br-radius);
    box-shadow: var(--br-shadow);
  }

  .br-hero,
  .br-panel {
    padding: 20px;
  }

  .br-hero-top,
  .br-panel-top,
  .br-row-top,
  .br-inline-actions,
  .br-suggestion-top,
  .br-toolbar,
  .br-overlay-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .br-hero-title,
  .br-panel-title,
  .br-row-title,
  .br-suggestion-title {
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .br-hero-title {
    font-size: 24px;
  }

  .br-subtitle,
  .br-status,
  .br-meta,
  .br-helper {
    color: var(--br-muted);
  }

  .br-status {
    border: 1px solid var(--br-line);
    background: var(--br-surface-muted);
    padding: 10px 12px;
    border-radius: var(--br-radius-sm);
  }

  .br-status[data-error="true"] {
    color: var(--br-danger);
    border-color: rgba(220, 38, 38, 0.2);
    background: #fef2f2;
  }

  .br-summary-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .br-summary-item {
    background: var(--br-surface-muted);
    border: 1px solid var(--br-line);
    border-radius: var(--br-radius-sm);
    padding: 14px;
  }

  .br-summary-value {
    display: block;
    font-size: 28px;
    font-weight: 800;
  }

  .br-stack {
    display: grid;
    gap: 12px;
  }

  .br-card,
  .br-suggestion {
    padding: 16px;
  }

  .br-row-title {
    font-size: 15px;
  }

  .br-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: #dbeafe;
    color: #1e3a8a;
  }

  .br-badge[data-variant="muted"] {
    background: #e2e8f0;
    color: #475569;
  }

  .br-badge[data-variant="warning"] {
    background: #fef3c7;
    color: #92400e;
  }

  .br-badge[data-variant="success"] {
    background: #dcfce7;
    color: #166534;
  }

  .br-body,
  .br-opinion,
  .br-search-result,
  .br-block {
    display: grid;
    gap: 8px;
  }

  .br-block {
    border: 1px solid var(--br-line);
    background: var(--br-surface-muted);
    border-radius: var(--br-radius-sm);
    padding: 12px;
  }

  .br-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--br-faint);
  }

  .br-textarea,
  .br-input,
  .br-select {
    width: 100%;
    border: 1px solid rgba(203, 213, 225, 0.9);
    border-radius: 12px;
    background: #fff;
    padding: 10px 12px;
    font: inherit;
    color: var(--br-ink);
  }

  .br-textarea {
    min-height: 92px;
    resize: vertical;
  }

  .br-input:focus,
  .br-textarea:focus,
  .br-select:focus {
    outline: none;
    border-color: rgba(29, 78, 216, 0.45);
    box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.1);
  }

  .br-button {
    border: 1px solid transparent;
    border-radius: 12px;
    padding: 10px 14px;
    background: #fff;
    color: var(--br-ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .br-button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .br-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .br-button[data-variant="primary"] {
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
  }

  .br-button[data-variant="danger"] {
    background: #fff5f5;
    border-color: rgba(220, 38, 38, 0.16);
    color: var(--br-danger);
  }

  .br-button[data-variant="ghost"] {
    border-color: var(--br-line);
    background: #fff;
  }

  .br-search-results,
  .br-suggestions {
    display: grid;
    gap: 10px;
  }

  .br-search-result {
    border: 1px solid var(--br-line);
    border-radius: 12px;
    background: #fff;
    padding: 12px;
  }

  .br-empty {
    border: 1px dashed rgba(148, 163, 184, 0.5);
    border-radius: 12px;
    padding: 18px;
    background: var(--br-surface-muted);
    color: var(--br-muted);
    text-align: center;
  }

  .br-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    font: 14px/1.55 var(--br-font);
  }

  .br-overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.42);
    backdrop-filter: blur(8px);
  }

  .br-overlay-shell {
    position: relative;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .br-overlay-dialog {
    width: min(980px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    overflow: auto;
    border-radius: 22px;
    background: transparent;
  }

  .br-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .br-tab {
    border: 1px solid var(--br-line);
    background: #fff;
    border-radius: 999px;
    padding: 8px 12px;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .br-tab[data-active="true"] {
    background: var(--br-accent-soft);
    border-color: rgba(29, 78, 216, 0.2);
    color: var(--br-accent);
  }

  .br-card details {
    width: 100%;
  }

  .br-card summary {
    list-style: none;
    cursor: pointer;
  }

  .br-card summary::-webkit-details-marker {
    display: none;
  }

  @media (max-width: 720px) {
    .br-page {
      padding: 14px;
    }

    .br-overlay-shell {
      padding: 10px;
    }

    .br-overlay-dialog {
      width: calc(100vw - 20px);
      max-height: calc(100vh - 20px);
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
