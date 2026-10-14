import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ stdin: { contents: "export * from './src/parsers/review-action-parser'; export * from './src/parsers/recording-audio';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { extractNormalizedFromEntry, enrichRecordingUrls, audioUrl } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const entry = { endpoint: 'getReviewActionDataById', status: 200, capturedAt: 'test', responseBody: JSON.stringify({ result: { data: { json: { actionId: 'task', actionLevel: 2, annotations: [], transcriptionChunkProcessedRecordings: [{ id: 'r', processedRecordingId: 'track', chunkedProcessedRecordingId: 'chunk', processedRecordingUrl: 'https://cdn.example/audio.wav?token=original' }], processedRecordingUriMap: { chunk: 's3://recordings/audio.wav' } } } } }) };
test('retains direct CDN links and source recording identity', () => {
  const recording = extractNormalizedFromEntry(entry).recordings[0];
  assert.equal(recording.processedRecordingUrl, 'https://cdn.example/audio.wav?token=original');
  assert.equal(recording.processedRecordingUri, 's3://recordings/audio.wav');
  assert.equal(recording.chunkedProcessedRecordingId, 'chunk');
});
test('resolves playable links via the same-origin authenticated Babel API', async () => {
  const enriched = await enrichRecordingUrls(entry, async (url, options) => {
    assert.ok(url.startsWith('/api/trpc/application.getAudioPresignedUrls?'));
    assert.equal(options.credentials, 'include');
    const input = JSON.parse(new URL(url, 'https://dashboard.babel.audio').searchParams.get('input'));
    assert.deepEqual(input['0'].json.s3Urls, ['s3://recordings/audio.wav']);
    return new Response(JSON.stringify([{ result: { data: { json: { 's3://recordings/audio.wav': 'https://cdn.example/audio.wav?token=fresh', unrelated: 'https://cdn.example/other.wav' } } } }]));
  });
  assert.equal(extractNormalizedFromEntry(enriched).recordings[0].processedRecordingUrl, 'https://cdn.example/audio.wav?token=fresh');
  assert.equal(enriched.recordingAudioUrls.unrelated, undefined);
});
test('failed URL lookup preserves transcript capture and rejects unsafe schemes', async () => {
  assert.equal(await enrichRecordingUrls(entry, async () => { throw Error('offline'); }), entry);
  assert.equal(audioUrl('javascript:alert(1)'), '');
  assert.equal(audioUrl('https://name:password@cdn.example/file'), '');
});

test('committed native annotations replace saved current content including deletions without changing recordings', () => {
  const saved = { actionId: 'task', actionLevel: 2, annotations: [{ id: 'old', content: 'Saved text' }] };
  const responseBody = JSON.stringify({ result: { data: { json: saved } } });
  const liveTranscript = { reviewActionId: 'task', annotations: [
    { id: 'new', type: 'transcription', intensity: 2, content: 'Unsaved native Slate edit', processedRecordingId: 'track', startTimeInSeconds: 2, endTimeInSeconds: 3, metadata: { source: 'native' } }
  ] };
  const current = extractNormalizedFromEntry({ ...entry, responseBody, liveTranscript });
  assert.equal(current.annotations.length, 1);
  assert.equal(current.annotations[0].id, 'new');
  assert.equal(current.annotations[0].content, 'Unsaved native Slate edit');
  assert.equal(current.annotations[0].type, 'transcription');
  assert.equal(current.annotations[0].intensity, 2);
  assert.deepEqual(current.annotations[0].metadata, { source: 'native' });
  assert.deepEqual(extractNormalizedFromEntry({ ...entry, responseBody, liveTranscript: { ...liveTranscript, annotations: [] } }).annotations, []);
});

test('live transcript never overlays an L1 reference or a different task capture', () => {
  for (const [actionId, actionLevel] of [['task', 1], ['other-task', 2]]) {
    const responseBody = JSON.stringify({ result: { data: { json: { actionId, actionLevel, annotations: [{ id: 'original', content: 'Stable reference' }] } } } });
    const normalized = extractNormalizedFromEntry({ ...entry, responseBody, liveTranscript: { reviewActionId: 'task', annotations: [{ id: 'edited', content: 'Wrong current' }] } });
    assert.equal(normalized.annotations[0].content, 'Stable reference');
  }
});
