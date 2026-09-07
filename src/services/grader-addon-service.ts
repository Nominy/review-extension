import { keyedRequest } from '../core/review-key';
import { loadState } from '../core/storage';
import { GRADER_PROTOCOL } from '@nominy/babel-babel-runtime';
import type { ReviewKernel } from '../core/types';

/** Read-only bridge for the separately installed Review Grader. No grades or notes are written here. */
export function registerGraderAddon(kernel: ReviewKernel): void {
  const requests = new Map<string, AbortController>();
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== window.location.origin || message?.source !== GRADER_PROTOCOL
      || message.direction !== 'request' || typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    const reply = (payload: unknown) => window.postMessage({ source: GRADER_PROTOCOL, direction: 'response', requestId: message.requestId, payload }, window.location.origin);
    if (message.operation === 'ping') { reply({ ok: true, version: 1 }); return; }
    if (message.operation === 'cancel-grade') { requests.get(message.gradeRequestId)?.abort(); return; }
    if (message.operation === 'grade') {
      const controller = new AbortController(); requests.set(message.requestId, controller);
      const timer = setTimeout(() => controller.abort(), 180000);
      try { const base = (await loadState()).settings.backendBaseUrl; reply({ ok: true, result: await keyedRequest(base, '/api/review/grade', message.input, controller.signal) }); }
      catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
      finally { clearTimeout(timer); requests.delete(message.requestId); }
      return;
    }
    if (message.operation !== 'snapshot') return;
    try { reply({ ok: true, snapshot: await kernel.prepareGradingSnapshot() }); }
    catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
}
