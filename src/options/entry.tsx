import { mountKeyPanel } from '../ui/key-panel';
import { createReactComponents } from '@nominy/babel-extension-frontend';
import React, { useEffect, useState } from 'react';

const Ui = createReactComponents(React.createElement);
import { createRoot } from 'react-dom/client';
import { DEFAULT_SETTINGS, RUNTIME_POLICY, sanitizeSettings } from '../core/runtime-config';
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
    const host = document.getElementById('review-key-panel');
    if (host && !host.children.length) mountKeyPanel(host, async () => (await loadState()).settings.backendBaseUrl);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const state = await loadState();
        const settings = sanitizeSettings(state.settings);
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
    state.settings = sanitizeSettings({
      ...state.settings,
      workflowMode,
      backendBaseUrl: backendBaseUrl.trim() || DEFAULT_SETTINGS.backendBaseUrl,
      backendBaseUrlFallbacks: backendFallbacks
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
      refreshTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_SETTINGS.refreshTimeoutMs
    });
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
    <Ui.Page as="div" accent="orange" className="br-page">
      <Ui.SettingsShell as="div" className="br-page-shell">
        <Ui.Surface as="div" className="br-shell-surface">
          <Ui.Header as="div" className="br-header">
            <div>
              <Ui.Title as="div" className="br-header-title">Babel Review settings</Ui.Title>
              <Ui.Status as="div" className="br-header-status" data-error={error}>{status}</Ui.Status>
            </div>
          </Ui.Header>
          <Ui.Body as="div" className="br-main">
            <Ui.Stack as="div" className="br-stack">
              <div id="review-key-panel" />
              <Ui.Card as="div" className="br-block">
                <Ui.Label as="label" className="br-label" htmlFor="workflowMode">Default workflow</Ui.Label>
                <select
                  className="br-select bui-select"
                  id="workflowMode"
                  onChange={(event) => setWorkflowMode(event.target.value === 'fast' ? 'fast' : 'interactive')}
                  value={workflowMode}
                >
                  <option value="interactive">Interactive review session</option>
                  <option value="fast">Fast route</option>
                </select>
              </Ui.Card>

              <Ui.Card as="div" className="br-block">
                <Ui.Label as="label" className="br-label" htmlFor="backendBaseUrl">Primary backend URL</Ui.Label>
                {RUNTIME_POLICY.allowBackendOverrides ? (
                  <input
                    className="br-input bui-input"
                    id="backendBaseUrl"
                    onChange={(event) => setBackendBaseUrl(event.target.value)}
                    type="url"
                    value={backendBaseUrl}
                  />
                ) : (
                  <Ui.Card as="div" className="br-readonly-value">{backendBaseUrl}</Ui.Card>
                )}
              </Ui.Card>

              {RUNTIME_POLICY.allowBackendOverrides ? (
                <Ui.Card as="div" className="br-block">
                  <Ui.Label as="label" className="br-label" htmlFor="backendFallbacks">Fallback backend URLs</Ui.Label>
                  <textarea
                    className="br-textarea bui-textarea"
                    id="backendFallbacks"
                    onChange={(event) => setBackendFallbacks(event.target.value)}
                    value={backendFallbacks}
                  />
                </Ui.Card>
              ) : (
                <Ui.Card as="div" className="br-block">
                  <Ui.Label as="div" className="br-label">Backend configuration</Ui.Label>
                  <Ui.Hint as="div" className="br-helper">
                    This Chrome Web Store build is locked to the production backend.
                  </Ui.Hint>
                </Ui.Card>
              )}

              <Ui.Card as="div" className="br-block">
                <Ui.Label as="label" className="br-label" htmlFor="refreshTimeoutMs">Refresh timeout (ms)</Ui.Label>
                <input
                  className="br-input bui-input"
                  id="refreshTimeoutMs"
                  min="1000"
                  onChange={(event) => setRefreshTimeoutMs(event.target.value)}
                  step="500"
                  type="number"
                  value={refreshTimeoutMs}
                />
              </Ui.Card>

              <Ui.Row as="div" className="br-inline-actions">
                <button
                  className="br-button bui-button"
                  data-variant="primary"
                  onClick={() =>
                    void persist().catch((nextError) => {
                      setStatus(nextError instanceof Error ? nextError.message : String(nextError));
                      setError(true);
                    })
                  }
                  type="button"
                >
                  Save
                </button>
                <button
                  className="br-button bui-button"
                  data-variant="ghost"
                  onClick={() =>
                    void reset().catch((nextError) => {
                      setStatus(nextError instanceof Error ? nextError.message : String(nextError));
                      setError(true);
                    })
                  }
                  type="button"
                >
                  Reset defaults
                </button>
              </Ui.Row>
              <Ui.Card as="div" className="br-block">
                <Ui.Hint as="div" className="br-helper">
                  These Babel tools are maintained by Naftsan;{' '}
                  <Ui.Button as="a"
                    className="br-button"
                    data-size="sm"
                    data-variant="ghost"
                    href="https://ko-fi.com/naftsan"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    if this extension saves you time, consider supporting development on Ko-Fi
                  </Ui.Button>
                </Ui.Hint>
              </Ui.Card>
            </Ui.Stack>
          </Ui.Body>
        </Ui.Surface>
      </Ui.SettingsShell>
    </Ui.Page>
  );
}

ensureReviewUiStyles();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Options root element is missing.');
}

createRoot(rootElement).render(<OptionsApp />);
