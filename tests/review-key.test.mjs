import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/core/review-key.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { keyedRequest, saveReviewKey, REVIEW_KEY_STORAGE } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('paid calls read the latest separate key and reject missing keys and untrusted origins', async () => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  const store = {}, requests = [];
  globalThis.chrome = { storage: { local: { get: async () => store, set: async values => Object.assign(store, values) } } };
  globalThis.fetch = async (url, init) => { requests.push({ url, key: init.headers['X-OpenRouter-Key'], body: init.body }); return Response.json({ ok: true }); };
  try {
    await assert.rejects(keyedRequest('https://reviewgen.ovh', '/api/review/generate', {}), /Save your OpenRouter key/);
    await saveReviewKey('sk-or-first');
    await keyedRequest('https://reviewgen.ovh', '/api/review/generate', { reviewActionId: 'fixture' });
    await saveReviewKey('sk-or-second');
    await keyedRequest('http://127.0.0.1:3001', '/api/templates-lab/replay', {});
    await assert.rejects(keyedRequest('https://example.com', '/api/review/generate', {}), /only be sent/);
    await assert.rejects(keyedRequest('https://reviewgen.ovh', '//example.com', {}), /Unsupported/);
    delete store[REVIEW_KEY_STORAGE];
    await assert.rejects(keyedRequest('https://reviewgen.ovh', '/api/review/generate', {}), /Save your/);
    assert.deepEqual(requests.map(item => item.key), ['sk-or-first', 'sk-or-second']);
    assert.ok(requests.every(item => !item.body.includes('sk-or-')));
  } finally { globalThis.chrome = oldChrome; globalThis.fetch = oldFetch; }
});
