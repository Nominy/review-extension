import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS } from '../core/constants';
import { loadState, saveState } from '../core/storage';
import { ensureReviewUiStyles } from '../ui/styles';

function OptionsApp() {
  const [status, setStatus] = useState('Loading settings...');
  const [error, setError] = useState(false);
  const [workflowMode, setWorkflowMode] = useState<'interactive' | 'fast'>(DEFAULT_SETTINGS.workflowMode);
  const [backendBaseUrl, setBackendBaseUrl] = useState(DEFAULT_SETTINGS.backendBaseUrl);
  const [backendFallbacks, setBackendFallbacks] = useState(DEFAULT_SETTINGS.backendBaseUrlFallbacks.join('\n'));
  const [refreshTimeoutMs, setRefreshTimeoutMs] = useState(String(DEFAULT_SETTINGS.refreshTimeoutMs));

  useEffect(() => {
    void (async () => {
      try {
        const state = await loadState();
        const settings = state.settings;
        setWorkflowMode(settings.workflowMode || DEFAULT_SETTINGS.workflowMode);
        setBackendBaseUrl(settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl);
        setBackendFallbacks((settings.backendBaseUrlFallbacks || DEFAULT_SETTINGS.backendBaseUrlFallbacks).join('\n'));
        setRefreshTimeoutMs(String(settings.refreshTimeoutMs || DEFAULT_SETTINGS.refreshTimeoutMs));
        setStatus('Settings loaded.');
        setError(false);
      } catch (nextError) {
        setStatus(nextError instanceof Error ? nextError.message : String(nextError));
        setError(true);
      }
    })();
  }, []);

  async function persist(): Promise<void> {
    const state = await loadState();
    const timeout = Number(refreshTimeoutMs);
    state.settings = {
      ...state.settings,
      workflowMode,
      backendBaseUrl: backendBaseUrl.trim() || DEFAULT_SETTINGS.backendBaseUrl,
      backendBaseUrlFallbacks: backendFallbacks
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      refreshTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SETTINGS.refreshTimeoutMs
    };
    await saveState(state);
    setStatus('Settings saved.');
    setError(false);
  }

  async function reset(): Promise<void> {
    const state = await loadState();
    state.settings = { ...DEFAULT_SETTINGS };
    await saveState(state);
    setWorkflowMode(DEFAULT_SETTINGS.workflowMode);
    setBackendBaseUrl(DEFAULT_SETTINGS.backendBaseUrl);
    setBackendFallbacks(DEFAULT_SETTINGS.backendBaseUrlFallbacks.join('\n'));
    setRefreshTimeoutMs(String(DEFAULT_SETTINGS.refreshTimeoutMs));
    setStatus('Settings reset to defaults.');
    setError(false);
  }

  return (
    <div className="br-page">
      <div className="br-page-shell" style={{ maxWidth: 720 }}>
        <div className="br-hero">
          <div className="br-hero-title">Babel Review Settings</div>
          <div className="br-subtitle">Configure workflow defaults and backend endpoints.</div>
          <div className="br-status" data-error={error}>{status}</div>
        </div>

        <div className="br-panel">
          <div className="br-stack">
            <div className="br-block">
              <label className="br-label" htmlFor="workflowMode">Default workflow</label>
              <select className="br-select" id="workflowMode" onChange={(event) => setWorkflowMode(event.target.value === 'fast' ? 'fast' : 'interactive')} value={workflowMode}>
                <option value="interactive">Interactive review session</option>
                <option value="fast">Fast route</option>
              </select>
            </div>

            <div className="br-block">
              <label className="br-label" htmlFor="backendBaseUrl">Primary backend URL</label>
              <input className="br-input" id="backendBaseUrl" onChange={(event) => setBackendBaseUrl(event.target.value)} type="url" value={backendBaseUrl} />
            </div>

            <div className="br-block">
              <label className="br-label" htmlFor="backendFallbacks">Fallback backend URLs</label>
              <textarea className="br-textarea" id="backendFallbacks" onChange={(event) => setBackendFallbacks(event.target.value)} value={backendFallbacks} />
            </div>

            <div className="br-block">
              <label className="br-label" htmlFor="refreshTimeoutMs">Refresh timeout (ms)</label>
              <input className="br-input" id="refreshTimeoutMs" min="1000" onChange={(event) => setRefreshTimeoutMs(event.target.value)} step="500" type="number" value={refreshTimeoutMs} />
            </div>

            <div className="br-inline-actions">
              <button className="br-button" data-variant="primary" onClick={() => void persist().catch((nextError) => {
                setStatus(nextError instanceof Error ? nextError.message : String(nextError));
                setError(true);
              })} type="button">
                Save
              </button>
              <button className="br-button" data-variant="ghost" onClick={() => void reset().catch((nextError) => {
                setStatus(nextError instanceof Error ? nextError.message : String(nextError));
                setError(true);
              })} type="button">
                Reset defaults
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ensureReviewUiStyles();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Options root element is missing.');
}

createRoot(rootElement).render(<OptionsApp />);
