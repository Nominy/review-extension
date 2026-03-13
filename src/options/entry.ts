import { DEFAULT_SETTINGS } from '../core/constants';
import { loadState, saveState } from '../core/storage';

const els = {
  status: document.getElementById('status') as HTMLDivElement,
  workflowMode: document.getElementById('workflowMode') as HTMLSelectElement,
  backendBaseUrl: document.getElementById('backendBaseUrl') as HTMLInputElement,
  backendFallbacks: document.getElementById('backendFallbacks') as HTMLTextAreaElement,
  refreshTimeoutMs: document.getElementById('refreshTimeoutMs') as HTMLInputElement,
  saveBtn: document.getElementById('saveBtn') as HTMLButtonElement,
  resetBtn: document.getElementById('resetBtn') as HTMLButtonElement
};

function setStatus(message: string, isError = false): void {
  els.status.textContent = message;
  els.status.dataset.error = isError ? 'true' : 'false';
}

async function populate(): Promise<void> {
  const state = await loadState();
  const settings = state.settings;
  els.workflowMode.value = settings.workflowMode || DEFAULT_SETTINGS.workflowMode;
  els.backendBaseUrl.value = settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl;
  els.backendFallbacks.value = (settings.backendBaseUrlFallbacks || DEFAULT_SETTINGS.backendBaseUrlFallbacks).join('\n');
  els.refreshTimeoutMs.value = String(settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs);
}

async function persist(): Promise<void> {
  const state = await loadState();
  const refreshTimeoutMs = Number(els.refreshTimeoutMs.value);
  state.settings = {
    ...state.settings,
    workflowMode: els.workflowMode.value === 'fast' ? 'fast' : 'interactive',
    backendBaseUrl: els.backendBaseUrl.value.trim() || DEFAULT_SETTINGS.backendBaseUrl,
    backendBaseUrlFallbacks: els.backendFallbacks.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    refreshTimeoutMs: Number.isFinite(refreshTimeoutMs) && refreshTimeoutMs > 0 ? refreshTimeoutMs : DEFAULT_SETTINGS.refreshTimeoutMs
  };
  await saveState(state);
  setStatus('Settings saved.', false);
}

async function reset(): Promise<void> {
  const state = await loadState();
  state.settings = { ...DEFAULT_SETTINGS };
  await saveState(state);
  await populate();
  setStatus('Settings reset to defaults.', false);
}

els.saveBtn.addEventListener('click', () => {
  void persist().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
});

els.resetBtn.addEventListener('click', () => {
  void reset().catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
});

void populate().then(() => {
  setStatus('Settings loaded.', false);
}).catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error), true);
});
