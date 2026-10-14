# Babel Review Helper

## Install and build

Requires Node.js 22.14+ and the shared platform at `../../shared/babel-extension-platform`. Initialize the parent checkout with `git submodule update --init --recursive` first.

From this directory:

```sh
npm --prefix ../../shared/babel-extension-platform ci
npm ci
npm run build:dev
```

Load `build/dev/` unpacked in `chrome://extensions`. Set the backend address and your OpenRouter key in extension settings. For local work, run the [backend](../review-backend/README.md) and use `http://127.0.0.1:3001`. Reload the extension and refresh Babel and Templates Lab after rebuilding.

```sh
npm run build:release
npm run build:zip
```

The release build goes to `build/release/`, is locked to `https://reviewgen.ovh`, and excludes local backend controls. The ZIP goes to `.artifacts/babel-review-helper-<version>.zip`. Build and packaging commands do not bump versions.

## Automatic Review Grader

Version 0.3.24 adds compatibility with the automatic [Review Grader](../babel-review-grader-extension/README.md). With the addon installed, Magic Review generates grades alongside feedback and applies them after comments; interactive refreshes regenerate grades. The status above Magic Review shows addon readiness, progress, and failures. Grading failures block comment application; without the addon, Magic Review continues with comments only.

Configure the OpenRouter key in Review Helper and use a backend with `/api/review/grade`. Reload both extensions and refresh the dashboard after updating. Helper 0.3.22 and the original 0.3.23 prerelease use the older, non-automatic integration.

Review compares the stable L1 reference with the current native transcript, including unsaved Slate text and annotation metadata. Navigation, changed evidence and readonly controls prevent stale application. Interactive finalization also stops if reviewer comments could not be saved; retry keeps those comments.

Review owns a lease on the shared native feedback-draft hydration gate. The gate waits for Babel's feedback field definitions to commit before delivering the unchanged draft response, preserving saved comments and ratings on cold reload without requiring Babel Helper. Babel Helper's `feedbackDraftRestore` switch controls its own lease only: turning it off does not disable protection while Review remains active. With Helper alone and that switch off, native behavior is unchanged. Navigation/disposal releases pending holds; the gate never rewrites response bodies or replaces another extension's fetch wrapper.

## Checks

```sh
npm run typecheck
npm test
```

Browser checks use the [shared browser setup](../../shared/babel-extension-platform/README.md#browser-checks).

## Publish

Follow the [store checklist](docs/chrome-store-release.md), [data disclosure](docs/chrome-store-data-disclosure.md), [privacy policy](docs/privacy-policy.md), and [listing copy](docs/chrome-store-listing.md).

Run `npm run version:patch` and commit `manifest.json`, `package.json`, and `package-lock.json` before merging. CI does not bump versions. The version must exceed the store's published and submitted versions.

Push to `main` creates a GitHub prerelease `v<version>`. To publish, manually run `.github/workflows/deploy-review-interceptor-extension.yml` on that commit with `version=<version>` and `confirm=PUBLISH <version>`. The tag must still be a prerelease pointing at the selected commit. `publish_type` defaults to `STAGED_PUBLISH`; `replace_pending_submission` cancels a pending review. A successful publish promotes the prerelease.

Required Actions secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`. Optional fallback: `CWS_ACCESS_TOKEN`.

For local publishing, copy `.env.cws.example` to ignored `.env.cws.local` and fill the credentials. Seed repository secrets with `node scripts/setup-github-secrets.mjs OWNER/REPO`; publish locally with `npm run publish:cws`.
