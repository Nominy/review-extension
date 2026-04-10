# Chrome Web Store Data Disclosure Summary

## What the extension accesses

- Babel review page content on `https://dashboard.babel.audio/*`
- Review action request and response payloads needed to assemble the review state
- Reviewer-entered comments that the extension writes back into the Babel review form
- Extension settings stored locally in `chrome.storage.local`

## What leaves the browser in the release build

- Current review action payloads required for:
  - `POST /api/review/generate`
  - `POST /api/review/sessions`
  - `GET /api/review/sessions/:id`
  - related interactive session endpoints
- Reviewer comments saved during interactive review sessions
- Final review application commands sent to the production backend

## What does not leave the browser by default in the release build

- Localhost or user-defined backend endpoints
- Submit-time analytics payloads from the extension
- Optional development sourcemaps

## Server-side processing

- The production backend may send review text to OpenRouter in order to classify review changes and suggest template matches.
- Backend analytics and raw text retention are disabled by default through:
  - `REVIEW_ANALYTICS_ENABLED=false`
  - `REVIEW_TEXT_PAIR_LOGGING_ENABLED=false`

## Retention and access

- Extension settings remain in the browser under `chrome.storage.local`.
- Interactive review session data is stored by the backend for the workflow to function.
- History browsing depends on backend analytics logging and is unavailable when analytics logging is disabled.

## Chrome disclosure guidance

- Single purpose: assist Babel reviewers with transcription review comments.
- Remote code: none.
- Localhost access in the store build: none.
- User data sale/transfer for advertising: none.
