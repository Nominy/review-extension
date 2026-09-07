import { test, expect } from '../../../../shared/babel-extension-platform/packages/babel-extension-e2e/src/test.mjs';

const MAGIC = '#babel-review-magic-button';
const WORKSPACE = '.br-overlay-dialog';
const FEEDBACK = 'textarea[placeholder="Provide specific feedback..."]';
const TRANSCRIPT = 'textarea[placeholder="What was said…"]';
const SETTINGS = 'babel.review.settings.v1';
const CATEGORY_PREFIX = {
  'Word Accuracy': 'wordAccuracy',
  'Timestamp Accuracy': 'timestampAccuracy',
  'Punctuation & Formatting': 'punctuationFormatting',
  'Tags & Emphasis': 'tagsEmphasis',
  Segmentation: 'segmentation',
};

async function configureReview(page, babel, workflowMode = 'fast', overrides = {}) {
  await babel.setExtensionSettings('review', {
    workflowMode,
    backendBaseUrl: babel.apiURL,
    backendBaseUrlFallbacks: [],
    refreshTimeoutMs: 4000,
  });
  await babel.reset('review', overrides);
  const url = new URL(page.url());
  url.searchParams.set('displayFeedback', 'true');
  await page.goto(url.href);
  await expect(page.getByText('L1 Feedback Form', { exact: true })).toBeVisible();
  await expect(page.locator(FEEDBACK)).toHaveCount(5);
  await expect(page.locator(MAGIC)).toBeEnabled();
  const keySettings = await babel.options('review');
  await keySettings.getByRole('textbox', { name: 'OpenRouter API key' }).fill('sk-or-review-browser-fixture');
  await keySettings.getByRole('button', { name: 'Save key', exact: true }).click();
  await expect(keySettings.getByText('Saved key ending ture.', { exact: false })).toBeVisible();
  await keySettings.close();
  await expect(page.getByRole('button', { name: 'OpenRouter', exact: true })).toHaveCount(0);
}

async function configureSuggestionReview(page, babel) {
  const state = await babel.state();
  // Genuine review evidence: L1 joins Russian negation incorrectly and omits
  // sentence punctuation; L2 corrects those independent word/formatting issues.
  // This justifies asking for reusable guidance, not requiring the model to invent it.
  const original = state.referenceAction.annotations.map((row, index) => ({
    ...row,
    ...(index === 0 ? { content: 'Я незнаю почему это произошло' } : {}),
    ...(index === 1 ? { content: 'сегодня мы проверяем редактор давайте продолжим' } : {}),
  }));
  const current = state.action.annotations.map((row, index) => ({
    ...row,
    ...(index === 0 ? { content: 'Я не знаю, почему это произошло.' } : {}),
    ...(index === 1 ? { content: 'Сегодня мы проверяем редактор. Давайте продолжим.' } : {}),
  }));
  await configureReview(page, babel, 'interactive', {
    referenceAction: { annotations: original },
    action: { annotations: current },
  });
}

async function expectSuggestions(page, babel, suggestions) {
  expect(Array.isArray(suggestions)).toBe(true);
  if (babel.ai === 'placeholder') expect(suggestions.length).toBeGreaterThanOrEqual(2);
  const workspace = page.locator(WORKSPACE);
  await expect(workspace.locator('.br-suggestion')).toHaveCount(suggestions.length);
  if (suggestions.length === 0) {
    await expect(workspace.getByText('No template suggestions yet.', { exact: true })).toBeVisible();
  }
  for (const [index, suggestion] of suggestions.entries()) {
    if (suggestion.title) await expect(workspace.locator('.br-suggestion').nth(index)).toContainText(suggestion.title);
    await expect(workspace.locator('.br-suggestion').nth(index).getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    await expect(workspace.locator('.br-suggestion').nth(index).getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
  }
}

function categoryCard(page, category) {
  const prefix = CATEGORY_PREFIX[category];
  expect(prefix, `Supported native feedback category: ${category}`).toBeTruthy();
  return page.locator(`#${prefix}-1`).locator(
    'xpath=ancestor::div[.//textarea[@placeholder="Provide specific feedback..."]][1]',
  );
}

async function backendResponse(page, pathname, action, method = 'POST') {
  const pending = page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname && response.request().method() === method,
  );
  await action();
  const response = await pending;
  expect(response.ok(), `${method} ${pathname}: ${response.status()}`).toBe(true);
  return { body: await response.json(), request: response.request().postDataJSON() };
}

async function expectDeliveredFeedback(page, feedback) {
  expect(Array.isArray(feedback)).toBe(true);
  expect(new Set(feedback.map((entry) => entry.category))).toEqual(new Set(Object.keys(CATEGORY_PREFIX)));
  for (const entry of feedback) {
    expect(typeof entry.note).toBe('string');
    expect(entry.note.trim()).not.toBe('');
    await expect(categoryCard(page, entry.category).locator(FEEDBACK)).toHaveValue(entry.note.slice(0, 500));
  }
}

async function generateFast(page) {
  return backendResponse(page, '/api/review/generate', () => page.locator(MAGIC).click());
}

async function openInteractive(page) {
  const result = await backendResponse(page, '/api/review/sessions', () => page.locator(MAGIC).click());
  await expect(page.locator(WORKSPACE)).toBeVisible();
  await expect(page.locator(`${WORKSPACE} .br-card`)).toHaveCount(result.body.cards.length);
  return result;
}

function expectStableComparison(request, state) {
  expect(request.reviewActionId).toBe(state.action.actionId);
  expect(request.original.actionId).toBe(state.referenceAction.actionId);
  expect(request.original.actionLevel).toBe(1);
  expect(request.current.actionId).toBe(state.action.actionId);
  expect(request.current.actionLevel).toBe(2);
  expect(request.babelDiff).toMatchObject({
    ok: true,
    currentReviewActionId: state.action.actionId,
    referenceReviewActionId: state.referenceAction.actionId,
  });
}

async function captureRealRequest(page, reviewActionId, transport) {
  return page.evaluate(async ({ reviewActionId, transport }) => {
    const input = encodeURIComponent(JSON.stringify({ 0: { json: { reviewActionId } } }));
    const url = `/api/trpc/transcriptions.getReviewActionDataById?batch=1&input=${input}`;
    let listener;
    let timer;
    const capture = new Promise((resolve, reject) => {
      listener = (event) => {
        const message = event.data;
        if (event.source === window && message?.source === 'babel-review-helper' &&
            message.type === 'review-action-captured' && message.payload?.transport === transport &&
            message.payload?.url === url) resolve(message.payload);
      };
      window.addEventListener('message', listener);
      timer = setTimeout(() => reject(new Error(`The injected Review bridge did not capture ${transport}`)), 10000);
    });
    try {
      let originalBody;
      if (transport === 'fetch') {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Native fetch failed: ${response.status}`);
        originalBody = await response.json();
      } else {
        originalBody = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url);
          xhr.onload = () => xhr.status === 200 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`XHR ${xhr.status}`));
          xhr.onerror = () => reject(new Error('Native XHR failed'));
          xhr.send();
        });
      }
      return { capture: await capture, originalBody };
    } finally {
      clearTimeout(timer);
      window.removeEventListener('message', listener);
    }
  }, { reviewActionId, transport });
}

async function closeNativeFeedback(page) {
  const panel = page.getByText('L1 Feedback Form', { exact: true }).locator(
    'xpath=ancestor::div[contains(@class,"fixed")][1]',
  );
  // The recovered native close control is intentionally icon-only.
  await panel.locator('button').filter({ has: page.locator('svg') }).first().click();
}

async function editCurrentTranscript(page, text) {
  await closeNativeFeedback(page);
  await page.locator(TRANSCRIPT).first().fill(text);
  await page.locator(TRANSCRIPT).first().press('Enter');
  await page.getByRole('button', { name: 'Save progress', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(page.locator(MAGIC)).toBeVisible();
}

test.describe('Review: real injected extension and native feedback', () => {
  test.use({ scenario: 'review', extensions: ['helper', 'gold', 'review'], reviewFlavor: 'dev' });

  test('fetch and XHR preserve caller responses and capture current L2 alongside stable L1', async ({ page, babel }) => {
    await configureReview(page, babel);
    const state = await babel.state();
    for (const transport of ['fetch', 'xhr']) {
      const result = await captureRealRequest(page, state.action.actionId, transport);
      expect(result.capture).toMatchObject({ transport, endpoint: 'getReviewActionDataById', status: 200, ok: true });
      expect(JSON.parse(result.capture.responseBody)).toEqual(result.originalBody);
      expect(JSON.stringify(result.originalBody)).toContain(state.action.actionId);
    }
    await captureRealRequest(page, state.referenceAction.actionId, 'xhr');
    // Remove only the URL hint: discovery must use the real current native React page context,
    // not the incidental L1 capture or a fabricated bridge event.
    await page.evaluate(() => history.replaceState(history.state, '', location.pathname));
    const result = await generateFast(page);
    expectStableComparison(result.request, state);
    await expectDeliveredFeedback(page, result.body.llm.feedback);
    if (babel.ai === 'placeholder') {
      for (const item of result.body.llm.feedback) expect(item.note).toMatch(/^\[E2E placeholder\]/);
    }
    await expect(page.locator(MAGIC)).toHaveCount(1);
    await closeNativeFeedback(page);
    await expect(page.locator('#babel-gold-drafting-magic-button')).toBeVisible();
    await page.getByRole('button', { name: 'Website Appearance', exact: true }).click();
    await expect(page.locator('[data-babel-helper-appearance-panel]')).toBeVisible();
    await page.getByRole('button', { name: 'Close Website Appearance editor', exact: true }).click();
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    await expectDeliveredFeedback(page, result.body.llm.feedback);
    await expect(page.locator('#babel-gold-drafting-magic-button')).toHaveCount(1);
    await expect(page.locator(MAGIC)).toHaveCount(1);
  });

  test('native queue claim is intercepted before Review discovers the newly claimed task', async ({ page, babel }) => {
    await configureReview(page, babel);
    await page.addInitScript(() => {
      window.__reviewCaptureObservations = [];
      window.addEventListener('message', (event) => {
        if (event.source === window && event.data?.source === 'babel-review-helper' &&
            event.data?.type === 'review-action-captured') {
          window.__reviewCaptureObservations.push(event.data.payload);
        }
      });
    });
    await babel.reset('review', { page: { search: '' } });
    await expect.poll(async () => (await babel.state()).claimed).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__reviewCaptureObservations.some((entry) =>
      entry.endpoint === 'claimNextReviewActionFromReviewQueue' && entry.ok))).toBe(true);
    await page.getByRole('button', { name: 'Feedback', exact: true }).click();
    const result = await generateFast(page);
    expectStableComparison(result.request, await babel.state());
    await expectDeliveredFeedback(page, result.body.llm.feedback);
  });

  test('fast review fills native feedback, preserves reviewer choices and autosaves controlled values', async ({ page, babel }) => {
    await configureReview(page, babel);
    for (const prefix of Object.values(CATEGORY_PREFIX)) {
      await expect(page.locator(`#${prefix}-1`)).toHaveAttribute('aria-checked', 'true');
    }
    await categoryCard(page, 'Word Accuracy').locator('label[for="wordAccuracy-3"]').click();
    await page.getByPlaceholder('Additional feedback...', { exact: true }).fill('Human observation: preserve this field.');
    const saved = page.waitForResponse((response) => response.url().includes('transcriptionFeedbackForm.saveDraft') &&
      response.request().postData()?.includes('Human observation: preserve this field.'));
    const result = await generateFast(page);
    expectStableComparison(result.request, await babel.state());
    await expectDeliveredFeedback(page, result.body.llm.feedback);
    await expect(page.locator('#wordAccuracy-3')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByPlaceholder('Additional feedback...', { exact: true })).toHaveValue('Human observation: preserve this field.');
    expect((await saved).ok()).toBe(true);
    // A second user change forces a new native autosave containing the applied React state.
    const persisted = page.waitForResponse((response) => response.url().includes('transcriptionFeedbackForm.saveDraft') &&
      response.request().postData()?.includes('Preserved after generated feedback.'));
    await page.getByPlaceholder('Additional feedback...', { exact: true }).fill('Preserved after generated feedback.');
    const nativeSave = await persisted;
    expect(nativeSave.ok()).toBe(true);
    const payload = nativeSave.request().postDataJSON();
    const savedValues = payload.json.inputResponses.map((entry) => entry.value);
    for (const item of result.body.llm.feedback) expect(savedValues).toContain(item.note.slice(0, 500));
  });

  test('every click recomputes current L2 after a genuine native edit without moving the L1 baseline', async ({ page, babel }) => {
    await configureReview(page, babel);
    const first = await generateFast(page);
    await expectDeliveredFeedback(page, first.body.llm.feedback);
    const edited = 'Привет, это исправленная проверка текущего текста.';
    await editCurrentTranscript(page, edited);
    const second = await generateFast(page);
    expectStableComparison(second.request, await babel.state());
    expect(second.request.original.annotations).toEqual(first.request.original.annotations);
    expect(second.request.current.annotations.some((row) => row.content === edited)).toBe(true);
    expect(second.request.current.annotations).not.toEqual(first.request.current.annotations);
    await expectDeliveredFeedback(page, second.body.llm.feedback);
  });

  test('interactive cards expand, persist comments, search, match and clear templates', async ({ page, babel }) => {
    await configureReview(page, babel, 'interactive');
    const { body: session, request } = await openInteractive(page);
    expectStableComparison(request, await babel.state());
    expect(session.cards.length).toBeGreaterThanOrEqual(2);
    const workspace = page.locator(WORKSPACE);
    const cards = workspace.locator('.br-card');
    await workspace.getByRole('button', { name: 'Expand All', exact: true }).click();
    await expect(workspace.locator('.br-card-body')).toHaveCount(session.cards.length);
    await workspace.getByRole('button', { name: 'Collapse All', exact: true }).click();
    await expect(workspace.locator('.br-card-body')).toHaveCount(0);
    await cards.first().locator('.br-card-header').click();
    await expect(cards.first().locator('.br-card-body')).toBeVisible();
    const cardId = String(session.cards[0].id || session.cards[0].changeIndex);
    const comment = 'Please retain the speaker wording when correcting this change.';
    const commentsPath = `/api/review/sessions/${session.sessionId}/comments`;
    const comments = await backendResponse(page, commentsPath, () =>
      cards.first().getByPlaceholder('Explain what should be different...').fill(comment));
    expect(comments.body.comments.cardComments[cardId]).toBe(comment);
    await cards.first().getByRole('button', { name: /^(Change|Match) template$/ }).click();
    const search = cards.first().getByPlaceholder('Search templates...');
    const searchResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/review/templates/search' &&
      new URL(response.url()).searchParams.get('q') === 'word');
    await search.fill('word');
    const templates = await (await searchResponse).json();
    expect(templates.results.length).toBeGreaterThan(0);
    const selected = templates.results[0];
    const match = await backendResponse(page, `/api/review/sessions/${session.sessionId}/cards/${cardId}/template-match`, () =>
      cards.first().locator('.br-search-result').filter({ hasText: selected.title }).getByRole('button', { name: 'Select', exact: true }).click());
    expect(match.body.cards.find((card) => String(card.id || card.changeIndex) === cardId)).toMatchObject({
      matchedTemplateId: selected.id, matchSource: 'manual',
    });
    await expect(cards.first()).toContainText(selected.title);
    const cleared = await backendResponse(page, `/api/review/sessions/${session.sessionId}/cards/${cardId}/template-clear`, () =>
      cards.first().getByRole('button', { name: 'Remove match', exact: true }).first().click());
    expect(cleared.body.cards.find((card) => String(card.id || card.changeIndex) === cardId).matchedTemplateId).toBeFalsy();
    await expect(cards.first()).toContainText('Template removed');
    await cards.first().getByRole('button', { name: 'Cancel', exact: true }).click();
    await cards.first().getByRole('button', { name: 'Match template', exact: true }).click();
    await search.fill('no-such-template-93ec711');
    await expect(cards.first().getByText('No results.', { exact: true })).toBeVisible();
    await search.clear();
    await expect(cards.first().locator('.br-search-result')).toHaveCount(0);
    await expect(cards.first().getByText('No results.', { exact: true })).toHaveCount(0);
    await workspace.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(workspace).toHaveCount(0);
  });

  test('returned suggestions accept reviewer decisions or valid empty completion and finalize into the native form', async ({ page, babel }) => {
    await configureSuggestionReview(page, babel);
    const { body: session } = await openInteractive(page);
    const workspace = page.locator(WORKSPACE);
    await workspace.getByRole('button', { name: 'Hide', exact: true }).click();
    await expect(workspace.getByPlaceholder('Optional note for the entire review session...')).toHaveCount(0);
    await workspace.getByRole('button', { name: 'Show', exact: true }).click();
    const note = 'L1 joins the Russian negation in «не знаю» and misses sentence punctuation. L2 corrects both. Suggest reusable guidance only where justified; retain approved guidance only.';
    await workspace.getByPlaceholder('Optional note for the entire review session...').fill(note);
    const rescanned = await backendResponse(page, `/api/review/sessions/${session.sessionId}/template-suggestions`, () =>
      workspace.getByRole('button', { name: 'Rescan for suggestions', exact: true }).click());
    expect(rescanned.body.comments.sessionComment).toBe(note);
    await expectSuggestions(page, babel, rescanned.body.suggestions);
    const decisions = [];
    for (const [index, suggestion] of rescanned.body.suggestions.entries()) {
      const decision = index % 2 === 0 ? 'approved' : 'rejected';
      const label = decision === 'approved' ? 'Approve' : 'Reject';
      const result = await backendResponse(page, `/api/review/sessions/${session.sessionId}/template-suggestions/${suggestion.proposalId}/decision`, () =>
        workspace.locator('.br-suggestion').nth(index).getByRole('button', { name: label, exact: true }).click());
      expect(result.body.suggestions.find((item) => item.proposalId === suggestion.proposalId).decision).toBe(decision);
      expect(result.body.comments.sessionComment).toBe(note);
      await expect(workspace.locator('.br-suggestion').nth(index).getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
      await expect(workspace.locator('.br-suggestion').nth(index).getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
      decisions.push({ proposalId: suggestion.proposalId, decision });
    }
    const finalized = await backendResponse(page, `/api/review/sessions/${session.sessionId}/finalize`, () =>
      workspace.getByRole('button', { name: 'Apply & Sync', exact: true }).click());
    expect(finalized.request).toEqual({ mode: 'apply' });
    await expect(workspace).toHaveCount(0);
    await expectDeliveredFeedback(page, finalized.body.categoryFeedback);
    const persisted = (await babel.state()).sessions[session.sessionId];
    expect(persisted.comments.sessionComment).toBe(note);
    expect(persisted.suggestions.map(({ proposalId, decision }) => ({ proposalId, decision }))).toEqual(decisions);
    expect(persisted).toMatchObject({ finalized: true, finalizeMode: 'apply' });
  });

  test('immediate finalization applies feedback without approving pending suggestions', async ({ page, babel }) => {
    await configureSuggestionReview(page, babel);
    const { body: session } = await openInteractive(page);
    const pending = await backendResponse(page, `/api/review/sessions/${session.sessionId}/template-suggestions`, () =>
      page.locator(WORKSPACE).getByRole('button', { name: 'Rescan for suggestions', exact: true }).click());
    await expectSuggestions(page, babel, pending.body.suggestions);
    for (const suggestion of pending.body.suggestions) expect(suggestion.decision ?? 'pending').toBe('pending');
    const result = await backendResponse(page, `/api/review/sessions/${session.sessionId}/finalize`, () =>
      page.locator(WORKSPACE).getByRole('button', { name: 'Apply without review', exact: true }).click());
    expect(result.request).toEqual({ mode: 'skip' });
    await expect(page.locator(WORKSPACE)).toHaveCount(0);
    await expectDeliveredFeedback(page, result.body.categoryFeedback);
    const finalized = (await babel.state()).sessions[session.sessionId];
    expect(finalized).toMatchObject({ finalized: true, finalizeMode: 'skip' });
    expect(finalized.suggestions.map(({ proposalId, decision }) => ({ proposalId, decision }))).toEqual(
      pending.body.suggestions.map(({ proposalId, decision }) => ({ proposalId, decision })),
    );
  });

  test('generation failure preserves native fields and Retry performs the complete stable comparison', async ({ page, babel }) => {
    await configureReview(page, babel);
    await categoryCard(page, 'Word Accuracy').locator(FEEDBACK).fill('Human feedback survives backend failure.');
    await babel.control({ routes: { '/api/review/generate': { error: { status: 422, message: 'E2E review generation rejected' } } } });
    await page.locator(MAGIC).click();
    await expect(page.locator(MAGIC)).toHaveText(/Retry/);
    await expect(categoryCard(page, 'Word Accuracy').locator(FEEDBACK)).toHaveValue('Human feedback survives backend failure.');
    await expect(page.locator('#babel-review-magic-toast')).toContainText('E2E review generation rejected');
    await babel.control({ routes: {}, procedures: {} });
    const retry = await generateFast(page);
    expectStableComparison(retry.request, await babel.state());
    await expectDeliveredFeedback(page, retry.body.llm.feedback);
  });
  test('finalization failure retains the session and comments until a successful Apply retry', async ({ page, babel }) => {
    await configureReview(page, babel, 'interactive');
    const { body: session } = await openInteractive(page);
    const workspace = page.locator(WORKSPACE);
    const note = 'Retain this reviewer decision across the failed apply.';
    await workspace.getByPlaceholder('Optional note for the entire review session...').fill(note);
    const path = `/api/review/sessions/${session.sessionId}/finalize`;
    await babel.control({ routes: { [path]: { error: { status: 422, message: 'E2E finalize rejected' } } } });
    await workspace.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(workspace.locator('.br-header-status')).toHaveAttribute('data-error', 'true');
    await expect(workspace.getByPlaceholder('Optional note for the entire review session...')).toHaveValue(note);
    expect((await babel.state()).sessions[session.sessionId].comments.sessionComment).toBe(note);
    await babel.control({ routes: {}, procedures: {} });
    const result = await backendResponse(page, path, () => workspace.getByRole('button', { name: 'Apply', exact: true }).click());
    await expect(workspace).toHaveCount(0);
    await expectDeliveredFeedback(page, result.body.categoryFeedback);
  });


  test('refresh and template errors stay recoverable in the existing interactive workspace', async ({ page, babel }) => {
    await configureReview(page, babel, 'interactive');
    const { body: initial } = await openInteractive(page);
    const workspace = page.locator(WORKSPACE);
    await babel.control({ routes: { '/api/review/sessions': { error: { status: 422, message: 'E2E refresh rejected' } } } });
    await workspace.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(workspace.locator('.br-header-status')).toHaveAttribute('data-error', 'true');
    await expect(workspace.locator('.br-card')).toHaveCount(initial.cards.length);
    await babel.control({ routes: {}, procedures: {} });
    const refreshed = await backendResponse(page, '/api/review/sessions', () => workspace.getByRole('button', { name: 'Refresh', exact: true }).click());
    await expect(workspace.locator('.br-header-status')).toHaveAttribute('data-error', 'false');
    const first = workspace.locator('.br-card').first();
    await first.locator('.br-card-header').click();
    await first.getByRole('button', { name: /^(Change|Match) template$/ }).click();
    await babel.control({ routes: { '/api/review/templates/search': { error: { status: 422, message: 'E2E template search rejected' } } } });
    await first.getByPlaceholder('Search templates...').fill('word');
    await expect(first).toContainText('E2E template search rejected');
    await babel.control({ routes: {}, procedures: {} });
    const recoveredSearch = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/review/templates/search' &&
      new URL(response.url()).searchParams.get('q') === 'word');
    await first.getByPlaceholder('Search templates...').clear();
    await first.getByPlaceholder('Search templates...').fill('word');
    expect((await recoveredSearch).ok()).toBe(true);
    await expect(first.locator('.br-search-result').first()).toBeVisible();
    const result = await backendResponse(page, `/api/review/sessions/${refreshed.body.sessionId}/finalize`, () =>
      workspace.getByRole('button', { name: 'Apply', exact: true }).click());
    await expectDeliveredFeedback(page, result.body.categoryFeedback);
  });

  test('options saved while editor stays alive survive fetch/XHR captures and a fresh runtime', async ({ page, babel }) => {
    await configureReview(page, babel);
    const options = await babel.options('review');
    await options.getByLabel('Default workflow', { exact: true }).selectOption('interactive');
    await options.getByLabel('Refresh timeout (ms)', { exact: true }).fill('6500');
    await options.getByLabel('Primary backend URL', { exact: true }).fill(babel.apiURL);
    await options.getByLabel('Fallback backend URLs', { exact: true }).fill('');
    await options.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(options.getByText('Settings saved.', { exact: true })).toBeVisible();
    const state = await babel.state();
    await captureRealRequest(page, state.action.actionId, 'fetch');
    await captureRealRequest(page, state.referenceAction.actionId, 'xhr');
    const stored = await options.evaluate(async (key) => (await chrome.storage.local.get(key))[key], SETTINGS);
    expect(stored).toMatchObject({ workflowMode: 'interactive', refreshTimeoutMs: 6500, backendBaseUrl: babel.apiURL, backendBaseUrlFallbacks: [] });
    await options.reload();
    await expect(options.getByLabel('Default workflow', { exact: true })).toHaveValue('interactive');
    await expect(options.getByLabel('Refresh timeout (ms)', { exact: true })).toHaveValue('6500');
    await page.reload();
    await expect(page.locator(MAGIC)).toBeVisible();
    await openInteractive(page);
    await options.getByRole('button', { name: 'Reset defaults', exact: true }).click();
    await expect(options.getByText('Settings reset to defaults.', { exact: true })).toBeVisible();
    await expect(options.getByLabel('Default workflow', { exact: true })).toHaveValue('interactive');
    await options.close();
  });

  test('L1 transcription does not acquire a writable native reviewer form or Magic action', async ({ page, babel }) => {
    await babel.reset('baseline');
    await expect(page.locator(TRANSCRIPT)).toHaveCount(4);
    await expect(page.locator(FEEDBACK)).toHaveCount(0);
    await expect(page.locator(MAGIC)).toHaveCount(0);
    const state = await babel.state();
    expect(state.action.actionLevel).toBe(1);
    expect(state.sessions).toEqual({});
    expect(state.submitted).toBe(false);
  });

  test('read-only native feedback and transcript cannot be changed by Review or coinstalled tools', async ({ page, babel }) => {
    await babel.reset('readonly');
    await expect(page.getByText('Feedback Received', { exact: true })).toBeVisible();
    await expect(page.locator(FEEDBACK)).toHaveCount(5);
    const before = await page.locator(FEEDBACK).evaluateAll((elements) => elements.map((element) => element.value));
    for (const field of await page.locator(FEEDBACK).all()) await expect(field).toBeDisabled();
    for (const prefix of Object.values(CATEGORY_PREFIX)) {
      await expect(page.locator(`#${prefix}-2`)).toHaveAttribute('aria-checked', 'true');
    }
    const stateBefore = await babel.state();
    await expect(page.locator(`${MAGIC}:enabled`)).toHaveCount(0);
    await page.keyboard.press('Alt+Delete');
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => page.locator(FEEDBACK).evaluateAll((elements) => elements.map((element) => element.value))).toEqual(before);
    for (const prefix of Object.values(CATEGORY_PREFIX)) {
      await expect(page.locator(`#${prefix}-2`)).toHaveAttribute('aria-checked', 'true');
    }
    const stateAfter = await babel.state();
    expect(stateAfter.action.annotations).toEqual(stateBefore.action.annotations);
    expect(stateAfter.submitted).toEqual(stateBefore.submitted);
  });

  test('navigation rediscovers a different task and clears legacy snapshots without duplicate extension UI', async ({ page, babel }) => {
    await configureReview(page, babel);
    const first = await generateFast(page);
    await expectDeliveredFeedback(page, first.body.llm.feedback);
    const options = await babel.options('review');
    await options.evaluate(async () => chrome.storage.local.set({
      'babel.review.sessions.v1': { stale: { actionId: '99999999-9999-4999-8999-999999999999' } },
      'babel.review.selected.v1': 'stale',
    }));
    const secondId = '55555555-5555-4555-8555-555555555555';
    const previous = await babel.state();
    await babel.reset('review', { action: { actionId: secondId, reviewActionId: secondId, annotations: previous.action.annotations.map((row) => ({ ...row, reviewActionId: secondId })) } });
    const url = new URL(page.url());
    url.searchParams.set('displayFeedback', 'true');
    await page.goto(url.href);
    await expect(page.locator(MAGIC)).toHaveCount(1);
    const second = await generateFast(page);
    expect(second.request.reviewActionId).toBe(secondId);
    expect(second.request.current.actionId).toBe(secondId);
    expect(second.request.current.actionId).not.toBe(first.request.current.actionId);
    await expectDeliveredFeedback(page, second.body.llm.feedback);
    const storage = await options.evaluate(async () => chrome.storage.local.get(['babel.review.sessions.v1', 'babel.review.selected.v1']));
    expect(storage).toEqual({ 'babel.review.sessions.v1': {}, 'babel.review.selected.v1': '' });
    await captureRealRequest(page, secondId, 'fetch');
    await captureRealRequest(page, secondId, 'xhr');
    await expect(page.locator(MAGIC)).toHaveCount(1);
    await options.close();
  });
});

for (const reviewFlavor of ['dev', 'release']) {
  test.describe(`Review ${reviewFlavor} artifact policy`, () => {
    test.use({ scenario: 'review', extensions: ['review'], reviewFlavor });

    test('native submit has flavor-specific analytics and backend options policy', async ({ page, babel }) => {
      await configureReview(page, babel);
      const options = await babel.options('review');
      if (reviewFlavor === 'release') {
        await expect(options.locator('#backendBaseUrl')).toHaveCount(0);
        await expect(options.locator('#backendFallbacks')).toHaveCount(0);
        await expect(options.getByText('https://reviewgen.ovh', { exact: true })).toBeVisible();
        const permissions = await options.evaluate(() => chrome.runtime.getManifest().host_permissions);
        expect(permissions.filter((entry) => /localhost/.test(entry))).toEqual([]);
      } else {
        await expect(options.getByLabel('Primary backend URL', { exact: true })).toHaveValue(babel.apiURL);
        await expect(options.getByLabel('Fallback backend URLs', { exact: true })).toBeVisible();
      }
      await options.close();
      const result = await generateFast(page);
      await expectDeliveredFeedback(page, result.body.llm.feedback);
      await closeNativeFeedback(page);
      const analytics = [];
      const observer = (request) => {
        if (request.method() !== 'POST' || !request.url().includes('submitTranscriptReviewAction')) return;
        const data = request.postDataJSON();
        if (data?.metadata?.source === 'review-helper-extension') analytics.push(data);
      };
      page.on('request', observer);
      await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
      const confirmation = page.getByRole('dialog');
      await expect(confirmation).toBeVisible();
      const submitted = page.waitForResponse((response) => response.url().includes('submitTranscriptReviewAction') &&
        !response.request().postDataJSON()?.metadata);
      await confirmation.getByRole('button', { name: 'Submit', exact: true }).click();
      expect((await submitted).ok()).toBe(true);
      await expect.poll(async () => (await babel.state()).submitted).toBe(true);
      if (reviewFlavor === 'dev') {
        await expect.poll(() => analytics.length).toBe(1);
        expect(analytics[0]).toMatchObject({ reviewActionId: result.request.reviewActionId, metadata: { workflowMode: 'fast' } });
        for (const item of result.body.llm.feedback) expect(analytics[0].inputBoxes.categories[item.category].note).toBe(item.note.slice(0, 500));
      } else {
        // Drain page bridge message tasks after the native submission; release never schedules analytics.
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(analytics).toEqual([]);
        expect((await babel.state()).analytics).toEqual([]);
      }
      page.off('request', observer);
    });
  });
}
