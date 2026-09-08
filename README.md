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
