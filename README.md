# Review Interceptor Extension

MV3 extension that intercepts Babel review traffic, talks to the Bun backend, and now supports both a fast auto-apply route and an interactive review-session route.

## Build

1. Install dependencies:
   - `npm install`
2. Build extension bundles:
   - `npm run build`
3. Load unpacked extension from `review-interceptor-extension/` in `chrome://extensions`.

Bundled outputs:
- `dist/content/entry.js`
- `dist/content/page-bridge.js`
- `dist/session/entry.js`
- `dist/options/entry.js`

## Architecture

Source lives under `src/`:
- `core/` constants, types, backend client, storage, kernel, lifecycle
- `parsers/` TRPC stream parsing and review action normalization
- `services/` page bridge injection plus review form/UI helpers
- `content/` Babel page entrypoints (`entry.ts`, `page-bridge.ts`)
- `session/` dedicated interactive review session window
- `options/` extension settings page

Static extension pages:
- `session.html` interactive review workflow window
- `options.html` extension settings

## Behavior

Runtime behavior now supports two workflows:
- `interactive` (default): `Magic Review` creates a backend session and opens the interactive extension window.
- `fast`: `Magic Review` calls `/api/review/generate` and immediately applies the feedback into the Babel form.

Interactive route:
- refreshes CURRENT state and transcription diff
- creates backend review session data
- opens `session.html`
- autosaves per-change comments and session-level comment
- requests template-improvement suggestions
- lets the user approve/reject template proposals
- sends an apply command back to the content script through `chrome.storage.local`

Fast route:
- keeps the original auto-fill behavior compatible with `/api/review/generate`

The extension settings page (`chrome-extension://.../options.html`) controls:
- default workflow mode
- backend base URL
- fallback backend URLs
- refresh timeout

## Backend expectations

Interactive route expects these endpoints in addition to the original generate flow:
- `POST /api/review/sessions`
- `GET /api/review/sessions/:id`
- `POST /api/review/sessions/:id/comments`
- `POST /api/review/sessions/:id/template-suggestions`
- `POST /api/review/sessions/:id/template-suggestions/:proposalId/decision`
- `POST /api/review/sessions/:id/finalize`

Fast route still uses:
- `POST /api/review/generate`
- `POST /api/trpc/transcriptions.submitTranscriptReviewAction`

## Validation

- `npm run typecheck`
- `npm run build`
- `npm run test`
