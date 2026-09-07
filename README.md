# Babel Review Helper Extension

MV3 extension for Babel transcription reviews. The project now builds in two flavors:

- `dev`: local iteration build with configurable backend endpoints and localhost fallback support.
- `release`: Chrome Web Store build locked to `https://reviewgen.ovh` with the minimum required permissions.

Interactive reviews use the in-page workspace on the Babel dashboard, with direct finalization when needed.

The separate **Babel Review Grader** addon uses this extension's versioned,
read-only snapshot bridge to retrieve the stable L1 original and freshly fetched
current review. It supplies its own grading UI and changes only native ratings;
Review Helper continues to handle feedback notes and interactive review sessions.
Close any open Review Helper workspace before grading. The backend must include
`POST /api/review/grade`; the addon uses the backend address configured here.

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
- `ui/` in-page review workspace
- `options/` extension settings page

Build outputs are generated into `build/<flavor>/`, including:

- `manifest.json`
- `options.html`
- `dist/content/entry.js`
- `dist/content/page-bridge.js`
- `dist/options/entry.js`
- `icons/*.png`

## Release Notes

- Release builds remove localhost host permissions and do not expose backend override controls.
- Release packaging excludes sourcemaps and validates that every manifest-referenced asset is present.
- Submit-time analytics from the extension are disabled in release builds.
- Review snapshots stay in memory; startup clears legacy stored snapshots. Network captures do not rewrite settings saved by the options page.
- Magic Review is available only for writable native feedback forms. Read-only feedback retains its existing comments and ratings; stale buttons are removed, and feedback application rechecks the native fields before writing.
- Template search clears obsolete matches while a new query is pending, shows an empty-results state for unmatched queries, and clears that state when the query is removed.

Supporting release docs live in [docs/chrome-store-release.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-release.md), [docs/chrome-store-data-disclosure.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-data-disclosure.md), and [docs/privacy-policy.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/privacy-policy.md).

GitHub Releases are the canonical home for packaged ZIPs. The version committed in `manifest.json`, `package.json` and `package-lock.json` is the release version: bump it in the PR with `npm run version:patch`; CI never bumps or commits versions. It must be greater than what the Chrome Web Store currently holds; the publish script checks the store's published and submitted versions and aborts otherwise.

Push to `main` (`.github/workflows/deploy-review-interceptor-extension.yml`, job `prerelease`) validates, builds the release flavor, packages the `.artifacts/` ZIP, uploads it as a workflow artifact, and creates a GitHub *pre-release* tagged `v<version>` at that commit. It never publishes to the Chrome Web Store. If `v<version>` is already a full release the job fails until the version is bumped.

Publishing to the Chrome Web Store is manual only: run the same workflow via `workflow_dispatch` (job `publish`) with `version` (must equal `manifest.json` on the selected ref, whose tag `v<version>` must point at that commit and still be a pre-release) and `confirm` set to `PUBLISH <version>`. `publish_type` defaults to `STAGED_PUBLISH`; `replace_pending_submission` cancels a pending review first. The job re-validates, rebuilds, uploads and publishes, then promotes the pre-release to a full release.

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
