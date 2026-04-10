# Babel Review Helper Privacy Policy

Last updated: 2026-04-10

Babel Review Helper is a browser extension used to help reviewers complete transcription review tasks in the Babel dashboard.

## Data the extension processes

The extension processes review-related information visible on `https://dashboard.babel.audio/*`, including review action payloads, reviewer comments, and workflow metadata required to generate or apply review feedback.

## How data is used

The extension sends the minimum workflow data required to the configured backend service so it can:

- generate category-specific review feedback
- create and reopen interactive review sessions
- save reviewer comments during an interactive session
- finalize a review and return feedback for application inside Babel

The Chrome Web Store release build is locked to the production backend at `https://reviewgen.ovh`.

## AI processing

The backend may use OpenRouter-backed language models to analyze review changes and generate template-backed feedback. This may include review text and related structured review metadata.

## Local storage

The extension stores settings and session coordination data in `chrome.storage.local` so the workflow can continue between extension pages.

## Logging and retention

Backend analytics logging and raw review text pair logging are disabled by default in the release configuration. When disabled, the backend does not retain those optional analytics records. Operational session data may still be stored as required for the interactive review workflow.

## Sharing

Data is processed only for the review-assistance workflow described above. It is not sold or shared for advertising.

## Contact

For operational questions about the extension deployment, contact the team responsible for the Babel Review Helper service.
