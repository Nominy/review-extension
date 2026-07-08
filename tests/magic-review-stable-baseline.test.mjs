import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

const CURRENT_L2_ID = '22222222-2222-4222-8222-222222222222';
const STABLE_L1_ID = '11111111-1111-4111-8111-111111111111';
const UNREVIEWED_L0_ID = '00000000-0000-4000-8000-000000000000';
const STORED_STALE_ID = '33333333-3333-4333-8333-333333333333';

function action(actionId, actionLevel, transcriptionChunkId = 'chunk-1') {
  return {
    actionId,
    actionLevel,
    actionDecision: `decision-${actionLevel}`,
    annotations: [
      {
        id: `annotation-${actionId}`,
        reviewActionId: actionId,
        type: 'rating',
        content: `content-${actionLevel}`,
        processedRecordingId: 'recording-1',
        category: 'Word Accuracy'
      }
    ],
    recordings: [
      {
        id: 'recording-1',
        transcriptionChunkId,
        audioUrl: '',
        referenceText: '',
        hypothesisText: ''
      }
    ],
    capturedAt: `2026-07-08T00:00:0${actionLevel}.000Z`,
    extractedReviewActionId: actionId,
    extractedFrom: 'test'
  };
}

function captured(actionId, actionLevel, transcriptionChunkId = 'chunk-1') {
  return {
    endpoint: 'getReviewActionDataById',
    status: 200,
    ok: true,
    url: `/api/trpc/transcriptions.getReviewActionDataById?reviewActionId=${actionId}`,
    method: 'POST',
    responseBody: '{}',
    requestBody: '{}',
    capturedAt: `2026-07-08T00:00:0${actionLevel}.000Z`,
    extractedReviewActionId: actionId,
    normalized: action(actionId, actionLevel, transcriptionChunkId)
  };
}

function storedSession(actionId, actionLevel = 0) {
  const baseline = action(actionId, actionLevel);
  return {
    reviewActionId: actionId,
    original: baseline,
    current: baseline,
    originalCapturedAt: baseline.capturedAt,
    currentCapturedAt: baseline.capturedAt
  };
}

function baseSettings(workflowMode = 'fast') {
  return {
    backendBaseUrl: 'https://reviewgen.test',
    backendBaseUrlFallbacks: [],
    refreshTimeoutMs: 1000,
    workflowMode
  };
}

function mockPlugin() {
  const modules = new Map([
    [
      './runtime-config',
      `export const DEFAULT_SETTINGS = { backendBaseUrl: 'https://reviewgen.test', backendBaseUrlFallbacks: [], refreshTimeoutMs: 1000, workflowMode: 'fast' };
       export const RUNTIME_POLICY = { enableSubmitAnalytics: false };
       export function sanitizeSettings(settings = {}) { return { ...DEFAULT_SETTINGS, ...settings }; }`
    ],
    [
      './storage',
      `export async function loadState() {
         return globalThis.__kernelHarness.storedState || { sessions: {}, settings: globalThis.__kernelHarness.settings || {}, selectedSessionId: '' };
       }
       export async function saveState(nextState) { globalThis.__kernelHarness.savedStates.push(nextState); }`
    ],
    [
      './backend-client',
      `export async function generate(args) {
         globalThis.__kernelHarness.backendCalls.push({ type: 'generate', args });
         return globalThis.__kernelHarness.generateResult || { llm: { feedback: [{ category: 'Word Accuracy', rating: 'good', comment: 'Looks right.' }] } };
       }
       export async function createReviewSession(args) {
         globalThis.__kernelHarness.backendCalls.push({ type: 'createReviewSession', args });
         return globalThis.__kernelHarness.sessionResult || { sessionId: 'session-1', reviewActionId: args.reviewActionId, cards: [], comments: { sessionComment: '', cardComments: {} } };
       }
       export async function submitTranscriptReviewActionAnalytics(args) { globalThis.__kernelHarness.backendCalls.push({ type: 'analytics', args }); }
       export async function decideReviewSessionSuggestion() { throw new Error('not used'); }
       export async function finalizeReviewSession() { throw new Error('not used'); }
       export async function generateReviewSessionSuggestions() { throw new Error('not used'); }
       export async function searchReviewTemplates() { throw new Error('not used'); }
       export async function clearReviewSessionCardTemplateMatch() { throw new Error('not used'); }
       export async function saveReviewSessionComments() { throw new Error('not used'); }
       export async function updateReviewSessionCardTemplateMatch() { throw new Error('not used'); }`
    ],
    [
      '../parsers/review-action-parser',
      `export function extractNormalizedFromEntry(entry) { return entry && entry.normalized ? entry.normalized : null; }`
    ],
    [
      '../services/page-bridge-service',
      `export function createPageBridgeService() {
         const harness = globalThis.__kernelHarness;
         const capturedHandlers = [];
         const diffHandlers = [];
         const bridge = {
           capturedHandlers,
           diffHandlers,
           emitCaptured(entry) { for (const handler of capturedHandlers) handler(entry); },
           emitDiff(payload) { for (const handler of diffHandlers) handler(payload); }
         };
         harness.bridge = bridge;
         return {
           inject() { harness.commands.push({ type: 'inject' }); },
           fetchCurrentReviewAction() {
             harness.commands.push({ type: 'fetchCurrentReviewAction' });
             if (harness.onFetchCurrentReviewAction) harness.onFetchCurrentReviewAction(bridge);
           },
           fetchReviewAction(reviewActionId) {
             harness.commands.push({ type: 'fetchReviewAction', reviewActionId });
             if (harness.onFetchReviewAction) harness.onFetchReviewAction(reviewActionId, bridge);
           },
           fetchTranscriptionDiff(payload) {
             harness.commands.push({ type: 'fetchTranscriptionDiff', payload });
             if (harness.onFetchTranscriptionDiff) harness.onFetchTranscriptionDiff(payload, bridge);
           },
           onReviewActionCaptured(handler) { capturedHandlers.push(handler); },
           onTranscriptionDiff(handler) { diffHandlers.push(handler); }
         };
       }`
    ],
    [
      '../services/review-form-service',
      `export function createReviewFormService() {
         const harness = globalThis.__kernelHarness;
         return {
           ensure(callback) { harness.magicReview = callback; },
           setState(state, label) { harness.formStates.push({ state, label }); },
           pushToast(message, isError) { harness.toasts.push({ message, isError }); },
           async applyFeedback(feedback) { harness.appliedFeedback.push(feedback); return { applied: feedback.length }; },
           collectInputBoxesSnapshot() { return []; }
         };
       }`
    ],
    [
      '../services/review-dialog-service',
      `export function createReviewDialogService() {
         const harness = globalThis.__kernelHarness;
         return {
           mount(callbacks) { harness.dialogCallbacks = callbacks; },
           openLoading(message) { harness.dialogEvents.push({ type: 'openLoading', message }); },
           renderSession(session, message) { harness.dialogEvents.push({ type: 'renderSession', session, message }); },
           setBusy(isBusy, message) { harness.dialogEvents.push({ type: 'setBusy', isBusy, message }); },
           setStatus(message, isError) { harness.dialogEvents.push({ type: 'setStatus', message, isError }); },
           close() { harness.dialogEvents.push({ type: 'close' }); },
           isOpen() { return false; },
           clearTemplateSearchState(cardId) { harness.dialogEvents.push({ type: 'clearTemplateSearchState', cardId }); },
           setTemplateSearchState(cardId, state) { harness.dialogEvents.push({ type: 'setTemplateSearchState', cardId, state }); }
         };
       }`
    ]
  ]);

  return {
    name: 'magic-review-test-mocks',
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, (args) => {
        if (modules.has(args.path)) {
          return { path: args.path, namespace: 'magic-review-mock' };
        }
        return null;
      });
      buildContext.onLoad({ filter: /.*/, namespace: 'magic-review-mock' }, (args) => ({
        contents: modules.get(args.path),
        loader: 'js'
      }));
    }
  };
}

async function loadKernelHarness({ href = `https://dashboard.babel.audio/review?reviewActionId=${CURRENT_L2_ID}`, storedState } = {}) {
  const result = await build({
    entryPoints: [path.join(rootDir, 'src/core/kernel.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'KernelBundle',
    write: false,
    plugins: [mockPlugin()]
  });

  const window = {
    location: { href },
    setTimeout,
    clearTimeout,
    console
  };
  const harness = {
    storedState,
    savedStates: [],
    commands: [],
    backendCalls: [],
    formStates: [],
    toasts: [],
    appliedFeedback: [],
    dialogEvents: []
  };
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    URL,
    window,
    __kernelHarness: harness
  });
  window.window = window;

  vm.runInContext(result.outputFiles[0].text, context, { filename: 'kernel-test-bundle.js' });
  const kernel = context.KernelBundle.createReviewKernel();
  await kernel.start();
  assert.equal(typeof harness.magicReview, 'function', 'kernel should register Magic Review callback');
  return { harness, kernel, context };
}

function emitStableL2Flow(harness, { currentId = CURRENT_L2_ID, stableId = STABLE_L1_ID, chunkId = 'chunk-1' } = {}) {
  harness.onFetchCurrentReviewAction = (bridge) => {
    bridge.emitCaptured(captured(currentId, 2, chunkId));
  };
  harness.onFetchReviewAction = (reviewActionId, bridge) => {
    if (reviewActionId === currentId) {
      bridge.emitCaptured(captured(currentId, 2, chunkId));
      return;
    }
    if (reviewActionId === stableId) {
      bridge.emitCaptured(captured(stableId, 1, chunkId));
      return;
    }
    bridge.emitCaptured(captured(reviewActionId, 0, chunkId));
  };
  harness.onFetchTranscriptionDiff = (payload, bridge) => {
    assert.equal(payload.reviewActionId, currentId);
    bridge.emitDiff({
      ok: true,
      currentReviewActionId: currentId,
      referenceReviewActionId: stableId,
      transcriptionChunkId: chunkId,
      capturedAt: '2026-07-08T00:00:03.000Z'
    });
  };
}

test('Magic Review discovers current L2 without a URL reviewActionId and ignores stale stored state', async () => {
  const { harness } = await loadKernelHarness({
    href: 'https://dashboard.babel.audio/review',
    storedState: {
      sessions: { [STORED_STALE_ID]: storedSession(STORED_STALE_ID, 1) },
      selectedSessionId: STORED_STALE_ID,
      settings: baseSettings('fast')
    }
  });
  emitStableL2Flow(harness);

  await harness.magicReview();

  const commands = harness.commands.filter((command) => command.type !== 'inject');
  assert.deepEqual(
    commands.map((command) => command.type),
    ['fetchCurrentReviewAction', 'fetchReviewAction', 'fetchTranscriptionDiff', 'fetchReviewAction']
  );
  assert.equal(commands[1].reviewActionId, CURRENT_L2_ID);
  assert.equal(commands[2].payload.reviewActionId, CURRENT_L2_ID);
  assert.equal(commands[3].reviewActionId, STABLE_L1_ID);
  assert.equal(commands.some((command) => command.reviewActionId === STORED_STALE_ID), false);

  assert.equal(harness.backendCalls.length, 1);
  assert.equal(harness.backendCalls[0].type, 'generate');
  assert.equal(harness.backendCalls[0].args.reviewActionId, CURRENT_L2_ID);
  assert.equal(harness.backendCalls[0].args.current.actionId, CURRENT_L2_ID);
  assert.equal(harness.backendCalls[0].args.original.actionId, STABLE_L1_ID);
});

test('fast Magic Review refreshes the stable L1 original before backend generation', async () => {
  const { harness } = await loadKernelHarness({
    storedState: { sessions: {}, selectedSessionId: '', settings: baseSettings('fast') }
  });
  emitStableL2Flow(harness);

  await harness.magicReview();

  assert.deepEqual(
    harness.commands.filter((command) => command.type !== 'inject').map((command) => command.type),
    ['fetchReviewAction', 'fetchTranscriptionDiff', 'fetchReviewAction']
  );
  assert.deepEqual(
    harness.commands.filter((command) => command.type === 'fetchReviewAction').map((command) => command.reviewActionId),
    [CURRENT_L2_ID, STABLE_L1_ID]
  );
  const generateCall = harness.backendCalls.find((call) => call.type === 'generate');
  assert.ok(generateCall, 'backend generation should run after the stable baseline is fetched');
  assert.equal(generateCall.args.reviewActionId, CURRENT_L2_ID);
  assert.equal(generateCall.args.original.actionId, STABLE_L1_ID);
  assert.equal(generateCall.args.original.actionLevel, 1);
  assert.equal(generateCall.args.current.actionId, CURRENT_L2_ID);
  assert.equal(generateCall.args.current.actionLevel, 2);
  assert.equal(harness.toasts.some((toast) => toast.isError), false);
});

test('interactive Magic Review sends L1-as-original and never promotes a non-L1 current capture to original', async () => {
  const { harness } = await loadKernelHarness({
    storedState: { sessions: {}, selectedSessionId: '', settings: baseSettings('interactive') }
  });
  emitStableL2Flow(harness);

  await harness.magicReview();

  const sessionCall = harness.backendCalls.find((call) => call.type === 'createReviewSession');
  assert.ok(sessionCall, 'interactive session creation should run');
  assert.equal(sessionCall.args.reviewActionId, CURRENT_L2_ID);
  assert.equal(sessionCall.args.current.actionId, CURRENT_L2_ID);
  assert.equal(sessionCall.args.current.actionLevel, 2);
  assert.equal(sessionCall.args.original.actionId, STABLE_L1_ID);
  assert.equal(sessionCall.args.original.actionLevel, 1);
  assert.notEqual(sessionCall.args.original.actionId, sessionCall.args.current.actionId);
  assert.equal(harness.toasts.some((toast) => toast.isError), false);
});

test('Magic Review does not promote incidental L1 captures to the current review', async () => {
  const { harness } = await loadKernelHarness({
    href: 'https://dashboard.babel.audio/review',
    storedState: { sessions: {}, selectedSessionId: '', settings: baseSettings('interactive') }
  });

  harness.onFetchCurrentReviewAction = (bridge) => {
    bridge.emitCaptured(captured(CURRENT_L2_ID, 2));
  };
  harness.onFetchReviewAction = (reviewActionId, bridge) => {
    if (reviewActionId === CURRENT_L2_ID) {
      bridge.emitCaptured(captured(CURRENT_L2_ID, 2));
      bridge.emitCaptured(captured(STABLE_L1_ID, 1));
      return;
    }
    if (reviewActionId === STABLE_L1_ID) {
      bridge.emitCaptured(captured(STABLE_L1_ID, 1));
      return;
    }
    bridge.emitCaptured(captured(reviewActionId, 0));
  };
  harness.onFetchTranscriptionDiff = (payload, bridge) => {
    assert.equal(payload.reviewActionId, CURRENT_L2_ID);
    bridge.emitDiff({
      ok: true,
      currentReviewActionId: CURRENT_L2_ID,
      referenceReviewActionId: STABLE_L1_ID,
      transcriptionChunkId: 'chunk-1',
      capturedAt: '2026-07-08T00:00:03.000Z'
    });
  };

  await harness.magicReview();

  const sessionCall = harness.backendCalls.find((call) => call.type === 'createReviewSession');
  assert.ok(sessionCall, 'interactive session creation should run');
  assert.equal(sessionCall.args.reviewActionId, CURRENT_L2_ID);
  assert.equal(sessionCall.args.current.actionId, CURRENT_L2_ID);
  assert.equal(sessionCall.args.current.actionLevel, 2);
  assert.equal(sessionCall.args.original.actionId, STABLE_L1_ID);
  assert.equal(sessionCall.args.original.actionLevel, 1);
});

async function loadPageBridgeHarness({ resourceUrls = [] } = {}) {
  const result = await build({
    entryPoints: [path.join(rootDir, 'src/content/page-bridge.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'PageBridgeBundle',
    write: false
  });

  const messages = [];
  const listeners = new Map();
  const fetchCalls = [];
  const performance = {
    getEntriesByType(type) {
      assert.equal(type, 'resource');
      return resourceUrls.map((name) => ({ name }));
    }
  };
  const document = { currentScript: { dataset: {} } };
  class FakeXMLHttpRequest {
    open() {}
    send() {}
    addEventListener() {}
  }
  const window = {
    __babelReviewPageBridgeInstalled: false,
    location: { href: 'https://dashboard.babel.audio/review' },
    postMessage(message) { messages.push(message); },
    addEventListener(type, listener) { listeners.set(type, listener); },
    fetch: async (url, init) => {
      const urlText = String(url);
      fetchCalls.push({ url: urlText, init });
      if (urlText.includes('transcriptions.getReviewActionsForChunk')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [
              {
                result: {
                  data: {
                    json: [
                      { id: UNREVIEWED_L0_ID, level: 0 },
                      { id: '44444444-4444-4444-8444-444444444444', level: 2 },
                      { id: STABLE_L1_ID, level: '1' }
                    ]
                  }
                }
              }
            ];
          }
        };
      }
      if (urlText.includes('transcriptions.getReviewActionDataById')) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify([{ result: { data: { json: action(CURRENT_L2_ID, 2) } } }]);
          }
        };
      }
      if (urlText.includes('transcriptions.getTranscriptionDiff')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{ result: { data: { json: { diff: [] } } } }];
          }
        };
      }
      throw new Error(`unexpected fetch: ${urlText}`);
    }
  };
  window.window = window;

  const context = vm.createContext({
    console,
    window,
    document,
    XMLHttpRequest: FakeXMLHttpRequest,
    URL,
    URLSearchParams,
    Request,
    Response,
    FormData,
    Blob,
    ArrayBuffer,
    Date,
    setTimeout,
    clearTimeout,
    performance
  });

  vm.runInContext(result.outputFiles[0].text, context, { filename: 'page-bridge-test-bundle.js' });
  return { messages, listeners, fetchCalls, window };
}

async function flushBridgeMessage(messages, type) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (messages.some((message) => message.type === type)) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${type}`);
}

async function flushBridgeWork(messages) {
  await flushBridgeMessage(messages, 'transcription-diff-fetched');
}

test('page bridge discovers current L2 from live getReviewActionsForChunk input and fetches its data', async () => {
  const reviewActionsInput = {
    0: {
      json: {
        reviewActionId: CURRENT_L2_ID
      }
    }
  };
  const reviewActionsUrl = `/api/trpc/transcriptions.getReviewActionsForChunk?batch=1&input=${encodeURIComponent(
    JSON.stringify(reviewActionsInput)
  )}`;
  const { messages, listeners, fetchCalls, window } = await loadPageBridgeHarness({
    resourceUrls: [reviewActionsUrl]
  });
  const messageHandler = listeners.get('message');
  assert.equal(typeof messageHandler, 'function', 'page bridge should install the command listener');

  messageHandler({
    source: window,
    data: {
      source: 'babel-review-overlay',
      type: 'fetch-current-review-action-data'
    }
  });
  await flushBridgeMessage(messages, 'review-action-captured');

  const dataCall = fetchCalls.find((call) => call.url.includes('transcriptions.getReviewActionDataById'));
  assert.ok(dataCall, 'bridge should auto-fetch current review action data after discovering the live L2 ID');
  assert.equal(dataCall.init.method, 'POST');
  const dataInput = JSON.parse(dataCall.init.body);
  assert.equal(dataInput['0'].json.reviewActionId, CURRENT_L2_ID);

  const event = messages.find((message) => message.type === 'review-action-captured');
  assert.equal(event.payload.ok, true);
  assert.equal(event.payload.extractedReviewActionId, CURRENT_L2_ID);
  assert.equal(event.payload.autoFetch, true);
  assert.equal(event.payload.triggeredByEndpoint, 'page-context');
});
test('page bridge stable-base discovery selects level 1 rather than L0 or minimum level', async () => {
  const { messages, listeners, fetchCalls, window } = await loadPageBridgeHarness();
  const messageHandler = listeners.get('message');
  assert.equal(typeof messageHandler, 'function', 'page bridge should install the command listener');

  messageHandler({
    source: window,
    data: {
      source: 'babel-review-overlay',
      type: 'fetch-transcription-diff',
      reviewActionId: CURRENT_L2_ID,
      transcriptionChunkId: 'chunk-1'
    }
  });
  await flushBridgeWork(messages);

  const reviewActionsCall = fetchCalls.find((call) => call.url.includes('transcriptions.getReviewActionsForChunk'));
  assert.ok(reviewActionsCall, 'bridge should ask Babel for actions related to the current L2 review action');
  const reviewActionsUrl = new URL(reviewActionsCall.url, 'https://dashboard.babel.audio');
  const reviewActionsInput = JSON.parse(reviewActionsUrl.searchParams.get('input'));
  assert.deepEqual(reviewActionsInput['0'].json, { reviewActionId: CURRENT_L2_ID });

  const diffCall = fetchCalls.find((call) => call.url.includes('transcriptions.getTranscriptionDiff'));
  assert.ok(diffCall, 'bridge should fetch a transcription diff after discovering the stable base');
  const diffUrl = new URL(diffCall.url, 'https://dashboard.babel.audio');
  const diffInput = JSON.parse(diffUrl.searchParams.get('input'));
  assert.equal(diffInput['0'].json.currentReviewActionId, CURRENT_L2_ID);
  assert.equal(diffInput['0'].json.referenceReviewActionId, STABLE_L1_ID);
  assert.notEqual(diffInput['0'].json.referenceReviewActionId, UNREVIEWED_L0_ID);

  const event = messages.find((message) => message.type === 'transcription-diff-fetched');
  assert.equal(event.payload.ok, true);
  assert.equal(event.payload.currentReviewActionId, CURRENT_L2_ID);
  assert.equal(event.payload.referenceReviewActionId, STABLE_L1_ID);
});
