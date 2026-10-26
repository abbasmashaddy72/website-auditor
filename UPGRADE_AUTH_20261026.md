# Authenticated Scans and Route Discovery — Code Upgrade

Source: the user-provided `Archive(3).zip` (formatted Website Auditor code).

## Changes

- Verified credential-based login before route discovery; failure is reported as a failed scan instead of a public-site crawl.
- Use the post-login landing URL, or the explicitly configured authenticated start URL. Do not fall back to public `/` for an authenticated crawl.
- Detect expired sessions and attempt one fresh sign-in before retrying the page.
- Expand safe navigation/sidebar accordion groups to discover protected links.
- Persist the profile name and landing URL in scan metadata and show profile association for scans, routes, errors, details, and exports.
- Add profile editing and optional login success URL/selector.
- Add result filters for scan and auth profile, and prevent Website card's button from silently starting an unauthenticated scan.
- Add pure authentication tests and optional offline localhost Playwright integration fixture.
- Retain old CLI, queue, RustFS, MongoDB, Lerd configuration, and worker supervisor. No destructive application/data changes.

## Compatibility

- Existing profiles continue working; `successUrl` and `successSelector` are optional.
- Existing scans and issues remain untouched. Historical results are not retrospectively relabeled.
- The `profiles` collection is updated only when you explicitly save a profile. Fields added to scan documents are optional. No migration required.
- Archive sanitization: `.env`, `tsconfig.tsbuildinfo`, partial `node_modules`, and generated files are excluded from the downloadable source ZIP.

## Tests

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor

git apply --check ~/Downloads/Website_Auditor_Authenticated_Scans_20261026.patch
git apply ~/Downloads/Website_Auditor_Authenticated_Scans_20261026.patch

npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:auth:browser

systemctl --user restart website-auditor-worker.service
systemctl --user restart lerd-app-website-auditor.service
```

**Note:** Restart the worker after the patch so new scans run the updated authentication logic; then create a **new** scan with a named profile. Completed public scans are immutable history.

## Current verification

TypeScript/TSX syntax parsing, JavaScript syntax checks, and the pure authentication decision logic were checked in the tool environment. Full dependency installation timed out, so production compilation, lint, and actual browser integration still require local execution. No scans against Insure360 were run here.
