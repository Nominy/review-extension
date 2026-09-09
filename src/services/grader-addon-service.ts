import { keyedRequest } from '../core/review-key';
import { loadState } from '../core/storage';
import { GRADER_PROTOCOL } from '@nominy/babel-babel-runtime';
import type { GraderAddon, GradingSnapshot } from '../core/types';

/** Optional addon lifecycle and its authenticated grading backend bridge. */
export function registerGraderAddon(): GraderAddon {
  const requests = new Map<string, AbortController>();
  const pending = new Map<string, { runId?: string; finish(payload?: { ok?: boolean; error?: string }): void }>();
  let sequence = 0;

  function request(operation: 'ping' | 'prepare' | 'apply' | 'cancel', runId?: string, input?: GradingSnapshot): Promise<boolean> {
    const requestId = `helper-${Date.now()}-${++sequence}`;
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    const timer = window.setTimeout(() => finish(undefined, true), operation === 'ping' ? 300 : 180000);
    function finish(payload?: { ok?: boolean; error?: string }, timedOut = false): void {
      window.clearTimeout(timer);
      pending.delete(requestId);
      if (payload?.ok === true) resolve(true);
      else if (timedOut && operation === 'ping') resolve(false);
      else reject(new Error(payload?.error || 'Review Grader did not respond. Please retry Magic Review.'));
    }
    pending.set(requestId, { runId, finish });
    try {
      window.postMessage({ source: GRADER_PROTOCOL, direction: 'addon-request', requestId, operation, runId, input }, window.location.origin);
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return promise;
  }

  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== window.location.origin || message?.source !== GRADER_PROTOCOL
      || typeof message.requestId !== 'string' || message.requestId.length > 100) return;
    if (message.direction === 'addon-response') {
      pending.get(message.requestId)?.finish(message.payload);
      return;
    }
    if (message.direction !== 'request') return;
    const reply = (payload: unknown) => window.postMessage({ source: GRADER_PROTOCOL, direction: 'response', requestId: message.requestId, payload }, window.location.origin);
    if (message.operation === 'cancel-grade') { requests.get(message.gradeRequestId)?.abort(); return; }
    if (message.operation !== 'grade') return;
    if (requests.has(message.requestId)) return;
    const controller = new AbortController(); requests.set(message.requestId, controller);
    const timer = window.setTimeout(() => controller.abort(), 180000);
    try { const base = (await loadState()).settings.backendBaseUrl; reply({ ok: true, result: await keyedRequest(base, '/api/review/grade', message.input, controller.signal) }); }
    catch (error) { reply({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    finally { window.clearTimeout(timer); requests.delete(message.requestId); }
  });

  return {
    available: () => request('ping'),
    async prepare(runId, input) { await request('prepare', runId, input); },
    async apply(runId, input) { await request('apply', runId, input); },
    cancel(runId) {
      for (const item of pending.values()) {
        if (item.runId === runId) item.finish({ ok: false, error: 'Review grading was cancelled.' });
      }
      void request('cancel', runId).catch(() => undefined);
    }
  };
}
