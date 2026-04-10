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

Packaged release artifact:

- `../babel-review-helper-0.3.0.zip`

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

## Validation

- `npm run typecheck`
- `npm test`
- `npm run build:release`
- `npm run build:zip`
