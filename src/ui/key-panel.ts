import { keyedRequest, readReviewKey, REVIEW_KEY_STORAGE, saveReviewKey } from '../core/review-key';
import { ensureReviewUiStyles } from './styles';

export function mountKeyPanel(host: HTMLElement, getBase: () => string | Promise<string>): void {
  ensureReviewUiStyles();
  const panel = document.createElement('section');
  panel.className = 'bui-root bui-card'; panel.dataset.buiAccent = 'orange';
  panel.style.cssText = 'padding:16px;display:grid;gap:10px;max-width:640px';
  panel.innerHTML = '<strong>OpenRouter</strong><p>Shared by Review Helper in Babel and Review Lab on this browser. Stored locally in the extension.</p><input class="bui-input" type="password" autocomplete="off" aria-label="OpenRouter API key" placeholder="sk-or-…"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="bui-button" type="button" data-action="save">Save key</button><button class="bui-button" type="button" data-action="remove">Remove key</button><button class="bui-button" type="button" data-action="usage">Check usage</button></div><p role="status" style="white-space:pre-line;margin:0"></p>';
  host.append(panel);
  const input = panel.querySelector('input')!;
  const status = panel.querySelector('[role=status]') as HTMLElement;
  let revision = 0;
  const refresh = async () => { const current = ++revision; const key = await readReviewKey(); if (current === revision) status.textContent = key ? `Saved key ending ${key.slice(-4)}. Ready in Babel and Lab.` : 'No key saved.'; };
  void refresh();
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && REVIEW_KEY_STORAGE in changes) void refresh(); });
  panel.addEventListener('click', async event => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    if (!action) return;
    const buttons = panel.querySelectorAll('button'); buttons.forEach(button => button.disabled = true);
    try {
      if (action === 'save') { await saveReviewKey(input.value); input.value = ''; await refresh(); }
      if (action === 'remove') { await chrome.storage.local.remove(REVIEW_KEY_STORAGE); input.value = ''; await refresh(); }
      if (action === 'usage') {
        const current = ++revision;
        status.textContent = 'Checking usage…';
        const data = await keyedRequest<Record<string, unknown>>(await getBase(), '/api/review/key-usage');
        const money = (value: unknown) => typeof value === 'number' ? `$${value.toFixed(4)}` : 'Unavailable';
        if (current === revision) status.textContent = `Key usage: ${money(data.usage)}\nToday: ${money(data.usage_daily)} · This month: ${money(data.usage_monthly)}\nRemaining key limit: ${data.limit_remaining === null ? 'No key limit' : money(data.limit_remaining)}\nThis is the key limit, not the account balance.`;
      }
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { buttons.forEach(button => button.disabled = false); }
  });
}
