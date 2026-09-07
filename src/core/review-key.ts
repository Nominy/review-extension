export const REVIEW_KEY_STORAGE = 'babel-review-openrouter-key-v1';

export async function readReviewKey(): Promise<string> {
  const data = await chrome.storage.local.get(REVIEW_KEY_STORAGE);
  return typeof data[REVIEW_KEY_STORAGE] === 'string' ? data[REVIEW_KEY_STORAGE] : '';
}

export async function saveReviewKey(value: string): Promise<void> {
  const key = value.trim();
  if (!key.startsWith('sk-or-') || key.length > 512 || /\s/.test(key)) throw new Error('Enter a valid OpenRouter key (sk-or-…).');
  await chrome.storage.local.set({ [REVIEW_KEY_STORAGE]: key });
}

export function trustedReviewBase(base: string): string {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the backend origin without a path.');
  if (!(url.origin === 'https://reviewgen.ovh' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('OpenRouter keys can only be sent to Reviewgen or a local review backend.');
  return url.origin;
}

export async function keyedRequest<T>(base: string, path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const origin = trustedReviewBase(base);
  if (!(path === '/api/review/key-usage' || path === '/api/review/generate' || path === '/api/review/sessions' || path === '/api/review/grade' || path === '/api/templates-lab/replay' || /^\/api\/review\/sessions\/[a-zA-Z0-9-]+\/template-suggestions$/.test(path))) throw new Error('Unsupported keyed request.');
  const key = await readReviewKey();
  if (!key) throw new Error('Save your OpenRouter key in Review Helper settings first.');
  const response = await fetch(origin + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OpenRouter-Key': key },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    credentials: 'same-origin', redirect: 'error', signal: signal || AbortSignal.timeout(180000)
  });
  if (response.status === 404 && path === '/api/review/grade') throw new Error('This backend does not support Review Grader yet. Update the review backend to include /api/review/grade.');
  if (response.status === 404) throw new Error('This review backend needs an update. The requested endpoint is not deployed.');
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Review backend returned an invalid response (HTTP ${response.status}). Check the backend address and deployment.`); }
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error.split(key).join('[key]') : `Review request failed (${response.status}).`);
  return data as T;
}
