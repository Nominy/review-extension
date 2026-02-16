# Review Interceptor Extension (Client + Server)

Chrome extension that intercepts review APIs, stores baseline state locally, and injects a single in-panel `Magic Review` button that calls backend (Bun + Elysia) for generation.

## What It Does

- Intercepts page-level `fetch` and `XMLHttpRequest`.
- Filters URLs containing `claimNextReviewActionFromReviewQueue` and `getReviewActionDataById`.
- When claim-next is captured, extracts ID strictly from `actionId` / `reviewActionId` fields and auto-calls `getReviewActionDataById`.
- Caches first `getReviewActionDataById` as authoritative `ORIGINAL`, and latest as `NEW`.
- Injects one `Magic Review` button into Babel's review panel.
- On click: refreshes latest reviewAction data, calls backend `/api/review/generate`, auto-fills grades and notes.
- Keeps captured baseline/current in `chrome.storage.local` so `ORIGINAL` is preserved.

## Cookies / Auth

- No `cookies.txt` is used by the extension.
- All calls run in page context on `dashboard.babel.audio` and use your active browser session cookies automatically.
- The follow-up call to `getReviewActionDataById` is sent with `credentials: "include"`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select folder: `review-interceptor-extension`.
5. Open `https://dashboard.babel.audio`.

## Run Backend (Bun)

1. `cd review-backend`
2. `bun install`
3. `bun run dev`
4. Default backend URL is `https://reviewgen.ovh`.
5. Automatic fallback URLs: `http://127.0.0.1:3001`, `http://localhost:3001`.

## Domain Setup

- Extension host permissions already include:
  - `https://reviewgen.ovh/*`
  - `http://127.0.0.1/*`
  - `http://localhost/*`
- So after server deployment, no extension code changes are required.

## Use

- Enter review mode to trigger claim-next and auto fetch action data.
- Open the Babel review feedback panel.
- Click `Magic Review`.
- Wait for spinner; scores and notes are auto-applied into category fields.

## Module Layout

- `constants.js`: shared constants.
- `storage.js`: local persistence helpers.
- `parser.js`: TRPC parsing and payload normalization.
- `backend-client.js`: calls backend `/prepare` and `/generate`.
- `content.js`: wand button injection, baseline caching, backend call, auto-fill.
- `injected.js`: network interception + page-context follow-up fetch.
