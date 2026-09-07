import { keyedRequest } from '../core/review-key';
import { mountKeyPanel } from '../ui/key-panel';

if (/^\/templates-lab\/?$/.test(location.pathname)) {
  const mountSettingsKeyPanel = () => {
    const host = document.querySelector<HTMLElement>('#labSettingsDialog #labSettingsKeyHost');
    if (!host) return false;
    if (host.dataset.labKeyMounted !== 'true') {
      mountKeyPanel(host, () => location.origin);
      host.dataset.labKeyMounted = 'true';
    }
    const unavailable = document.querySelector<HTMLElement>('#labSettingsDialog #labKeyUnavailable');
    if (unavailable) unavailable.hidden = true;
    return true;
  };
  if (!mountSettingsKeyPanel()) {
    const observer = new MutationObserver(() => {
      if (mountSettingsKeyPanel()) observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  const protocol = 'babel-review-lab-key-v1';
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== protocol || data.direction !== 'request' || typeof data.requestId !== 'string' || data.requestId.length > 100) return;
    if (data.operation !== 'replay' && data.operation !== 'ping') return;
    const reply = (payload: unknown) => window.postMessage({ source: protocol, direction: 'response', requestId: data.requestId, payload }, location.origin);
    try { reply({ ok: true, result: data.operation === 'ping' ? true : await keyedRequest(location.origin, '/api/templates-lab/replay', data.body) }); }
    catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
}
