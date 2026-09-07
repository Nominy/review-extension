import { GRADER_PROTOCOL } from '@nominy/babel-babel-runtime';
import type { ReviewKernel } from '../core/types';

/** Read-only bridge for the separately installed Review Grader. No grades or notes are written here. */
export function registerGraderAddon(kernel: ReviewKernel): void {
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== window.location.origin || message?.source !== GRADER_PROTOCOL
      || message.direction !== 'request' || typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    const reply = (payload: unknown) => window.postMessage({ source: GRADER_PROTOCOL, direction: 'response', requestId: message.requestId, payload }, window.location.origin);
    if (message.operation === 'ping') { reply({ ok: true, version: 1 }); return; }
    if (message.operation !== 'snapshot') return;
    try { reply({ ok: true, snapshot: await kernel.prepareGradingSnapshot() }); }
    catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
}
