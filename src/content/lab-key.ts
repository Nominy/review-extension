import { keyedRequest } from '../core/review-key';
import { mountKeyPanel } from '../ui/key-panel';

if (/^\/templates-lab\/?$/.test(location.pathname)) {
  const host = document.createElement('div'); host.style.marginBottom = '20px';
  (document.querySelector('.hero') || document.body.firstElementChild)?.after(host);
  mountKeyPanel(host, () => location.origin);
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
