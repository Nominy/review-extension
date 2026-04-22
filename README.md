# Babel Review Helper Extension

MV3 extension for Babel transcription reviews. The project now builds in two flavors:

- `dev`: local iteration build with configurable backend endpoints and localhost fallback support.
- `release`: Chrome Web Store build locked to `https://reviewgen.ovh` with the minimum required permissions.

## Build

1. Install dependencies:
   - `npm install`
2. Build a local dev extension:
   - `npm run build:dev`
3. Build the Chrome Web Store release extension:
   - `npm run build:release`
4. Package the release zip:
   - `npm run build:zip`

Load unpacked from:

- `review-interceptor-extension/build/dev/`
- `review-interceptor-extension/build/release/`

Versioning:
- `npm run build:dev`, `npm run build:release`, and `npm run build:zip` are pure and do not change version files.
- `npm run version:patch` bumps `package.json`, `manifest.json`, and `package-lock.json` for the next release.

Packaged release artifact:

- `.artifacts/babel-review-helper-<version>.zip`

## Architecture

Source lives under `src/`:

- `core/` constants, types, runtime policy, storage, backend client, kernel, lifecycle
- `parsers/` TRPC stream parsing and review action normalization
- `services/` page bridge injection plus review form/UI helpers
- `content/` Babel page entrypoints (`entry.ts`, `page-bridge.ts`)
- `session/` dedicated interactive review session window
- `options/` extension settings page

Build outputs are generated into `build/<flavor>/`, including:

- `manifest.json`
- `options.html`
- `session.html`
- `dist/content/entry.js`
- `dist/content/page-bridge.js`
- `dist/session/entry.js`
- `dist/options/entry.js`
- `icons/*.png`

## Release Notes

- Release builds remove localhost host permissions and do not expose backend override controls.
- Release packaging excludes sourcemaps and validates that every manifest-referenced asset is present.
- Submit-time analytics from the extension are disabled in release builds.

Supporting release docs live in [docs/chrome-store-release.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-release.md), [docs/chrome-store-data-disclosure.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-data-disclosure.md), and [docs/privacy-policy.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/privacy-policy.md).

GitHub Releases are the canonical home for packaged ZIPs. The manual release workflow builds the `.artifacts/` ZIP, tags the released commit as `v<version>`, and uploads the ZIP asset there.

Chrome Web Store deployment uses `.github/workflows/deploy-review-interceptor-extension.yml`. It runs `npm run version:patch`, validates the release build, packages the `.artifacts/` ZIP, publishes it to the Chrome Web Store, commits the bumped version files, and then updates the matching GitHub Release asset.

Required GitHub Actions secrets:
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`

Optional GitHub Actions secret:
- `CWS_ACCESS_TOKEN`

For local publishing helpers, keep Chrome Web Store credentials in `.env.cws.local` and start from `.env.cws.example`.
To seed the GitHub Actions secrets from the local dotenv file, run `node scripts/setup-github-secrets.mjs OWNER/REPO`.

## Validation

- `npm run typecheck`
- `npm test`
- `npm run build:release`
- `npm run build:zip`
