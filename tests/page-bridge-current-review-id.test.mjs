import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

const CURRENT_L2_ID = '22222222-2222-4222-8222-222222222222';
const STALE_ID = '33333333-3333-4333-8333-333333333333';

function action(actionId) {
  return {
    actionId,
    actionLevel: 2,
    actionDecision: 'current-decision',
    annotations: [
      {
        id: `annotation-${actionId}`,
        reviewActionId: actionId,
        type: 'rating',
        content: 'Looks right.',
        processedRecordingId: 'recording-1',
        category: 'Word Accuracy'
      }
    ],
    recordings: [
      {
        id: 'recording-1',
        transcriptionChunkId: 'chunk-1',
        audioUrl: '',
        referenceText: '',
        hypothesisText: ''
      }
    ],
    capturedAt: '2026-07-08T00:00:02.000Z',
    extractedReviewActionId: actionId,
    extractedFrom: 'test'
  };
}

function responseFromText(bodyText) {
  return {
    ok: true,
    status: 200,
    async text() {
      return bodyText;
    },
    clone() {
      return responseFromText(bodyText);
    }
  };
}

function makeDocument({ scriptTexts = [], visibleText = '' } = {}) {
  const scripts = scriptTexts.map((text) => ({
    text,
    textContent: text,
    innerText: text,
    innerHTML: text
  }));
  const body = {
    textContent: visibleText,
    innerText: visibleText,
    innerHTML: visibleText
  };
  const documentElement = {
    textContent: visibleText,
    innerText: visibleText,
    innerHTML: visibleText
  };

  return {
    currentScript: { dataset: {} },
    scripts,
    body,
    documentElement,
    querySelectorAll(selector) {
      return String(selector).includes('script') ? scripts : [];
    },
    getElementsByTagName(tagName) {
      return String(tagName).toLowerCase() === 'script' ? scripts : [];
    }
  };
}

async function loadPageBridgeHarness({ resourceUrls = [], scriptTexts = [], visibleText = '' } = {}) {
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
  const document = makeDocument({ scriptTexts, visibleText });
  class FakeXMLHttpRequest {
    open() {}
    send() {}
    addEventListener() {}
  }
  const window = {
    __babelReviewPageBridgeInstalled: false,
    location: { href: 'https://dashboard.babel.audio/review' },
    postMessage(message) {
      messages.push(message);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    fetch: async (url, init) => {
      const urlText = String(url);
      fetchCalls.push({ url: urlText, init });
      assert.equal(
        urlText.includes('transcriptions.getReviewActionsForChunk'),
        false,
        'current review discovery must not depend on getReviewActionsForChunk when the page payload exposes the ID'
      );
      if (urlText.includes('transcriptions.getReviewActionDataById')) {
        const requestBody = JSON.parse(init.body);
        const reviewActionId = requestBody['0'].json.reviewActionId;
        return responseFromText(JSON.stringify([{ result: { data: { json: action(reviewActionId) } } }]));
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

  vm.runInContext(result.outputFiles[0].text, context, { filename: 'page-bridge-current-review-id-test-bundle.js' });
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

function sendFetchCurrentReviewActionCommand(listeners, window) {
  const messageHandler = listeners.get('message');
  assert.equal(typeof messageHandler, 'function', 'page bridge should install the command listener');
  messageHandler({
    source: window,
    data: {
      source: 'babel-review-overlay',
      type: 'fetch-current-review-action-data'
    }
  });
}

async function assertCurrentReviewActionFetchedFromPage(harness) {
  sendFetchCurrentReviewActionCommand(harness.listeners, harness.window);
  await flushBridgeMessage(harness.messages, 'review-action-captured');

  const dataCalls = harness.fetchCalls.filter((call) => call.url.includes('transcriptions.getReviewActionDataById'));
  assert.equal(dataCalls.length, 1, 'bridge should auto-fetch the current review action data exactly once');
  assert.equal(dataCalls[0].url, '/api/trpc/transcriptions.getReviewActionDataById?batch=1');
  assert.equal(dataCalls[0].init.method, 'POST');
  assert.equal(dataCalls[0].init.credentials, 'include');
  assert.equal(dataCalls[0].init.headers['Content-Type'], 'application/json');
  const dataInput = JSON.parse(dataCalls[0].init.body);
  assert.equal(dataInput['0'].json.reviewActionId, CURRENT_L2_ID);

  const event = harness.messages.find((message) => message.type === 'review-action-captured');
  assert.equal(event.source, 'babel-review-helper');
  assert.equal(event.payload.endpoint, 'getReviewActionDataById');
  assert.equal(event.payload.ok, true);
  assert.equal(event.payload.autoFetch, true);
  assert.equal(event.payload.manualTrigger, true);
  assert.equal(event.payload.triggeredByEndpoint, 'page-context');
  assert.equal(event.payload.triggeredByUrl, 'https://dashboard.babel.audio/review');
  assert.equal(event.payload.extractedReviewActionId, CURRENT_L2_ID);
  assert.equal(JSON.parse(event.payload.requestBody)['0'].json.reviewActionId, CURRENT_L2_ID);
  assert.equal(JSON.parse(event.payload.responseBody)[0].result.data.json.actionId, CURRENT_L2_ID);
}

test('page bridge fetches current review action discovered from a Next React payload when no performance action entry exists', async () => {
  const nextPayload = `self.__next_f.push([1,"$L16","\\\"reviewActionId\\\":\\\"${CURRENT_L2_ID}\\\",\\\"status\\\":\\\"current\\\""]);`;
  const harness = await loadPageBridgeHarness({
    resourceUrls: [
      '/api/trpc/transcriptions.getReviewActionDataById?batch=1',
      `/api/trpc/someOtherProcedure?input=${encodeURIComponent(JSON.stringify({ reviewActionId: STALE_ID }))}`
    ],
    scriptTexts: [nextPayload]
  });

  await assertCurrentReviewActionFetchedFromPage(harness);
});

test('page bridge fetches current review action discovered from visible support ID text when no performance action entry exists', async () => {
  const harness = await loadPageBridgeHarness({
    resourceUrls: ['/api/trpc/someOtherProcedure?batch=1'],
    visibleText: `Support\nID: ${CURRENT_L2_ID}\nUse this ID when contacting Babel support.`
  });

  await assertCurrentReviewActionFetchedFromPage(harness);
});
