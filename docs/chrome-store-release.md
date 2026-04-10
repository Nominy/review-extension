# Chrome Web Store Release Checklist

## Scope

This checklist is for the production-only `release` build that targets unlisted tester distribution through the Chrome Web Store.

## Build

1. Run `npm install`.
2. Run `npm run typecheck`.
3. Run `npm test`.
4. Run `npm run build:release`.
5. Run `npm run build:zip`.

Expected outputs:

- `build/release/manifest.json`
- `build/release/options.html`
- `build/release/session.html`
- `build/release/dist/...`
- `build/release/icons/...`
- `../babel-review-helper-0.3.0.zip`

## Verify Before Upload

- Manifest name is `Babel Review Helper`.
- Permissions contain only `storage`.
- Host permissions contain only:
  - `https://dashboard.babel.audio/*`
  - `https://reviewgen.ovh/*`
- No manifest resource references a `.map` file.
- Options page does not allow editing backend endpoints.
- Release build points only at `https://reviewgen.ovh`.
- Release zip contains every manifest-referenced file.

## Store Submission Materials

- Use the listing copy from [chrome-store-listing.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-listing.md).
- Use the disclosure summary from [chrome-store-data-disclosure.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/chrome-store-data-disclosure.md).
- Publish the privacy policy from [privacy-policy.md](/C:/Users/User/Desktop/dev/babel/reviewer/review-interceptor-extension/docs/privacy-policy.md).
- Attach the generated icon set and the files under `store-assets/`.

## Backend Readiness

- Production backend CORS must allow `https://dashboard.babel.audio`.
- `REVIEW_ANALYTICS_ENABLED` should remain `false` unless operational logging is explicitly approved.
- `REVIEW_TEXT_PAIR_LOGGING_ENABLED` should remain `false` unless raw text retention is explicitly approved.
- Templates Lab and History API credentials should stay internal-only.
