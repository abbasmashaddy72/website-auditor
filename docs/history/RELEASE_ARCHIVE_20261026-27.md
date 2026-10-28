# Historic implementation notes — 26–27 October 2026

Original content is retained below, with source filenames preserved as headings. These notes describe historical releases and may not reflect the current implementation. Verification reports remain separate files.

## Original: `AUTH_LIVEWIRE_FIX_20261026.md`

# Website Auditor — Filament / Livewire authentication hotfix

## Changes

- Allow authorized login-phase POST requests to hashed Livewire 3 endpoints such as `/livewire-84119ac4/update`, to the configured login route, or to the discovered same-origin login form action.
- Continue rejecting arbitrary POST requests during normal crawling. Permit only Livewire component hydrations with no field changes and no actions (except the reserved `__lazyLoad` method). Such blocked requests become scan warnings rather than false 'passed' results.
- Detect login-form redirects from a configured URL such as `/cadmin` to `/cadmin/login`, using the actual rendered login URL when waiting for successful navigation.
- Include safe diagnostics for failed authentication, including blocked requests and generic target error banners, without logging credentials.
- Keep automatic crawl discovery in protected `/cadmin/...` and similar panel areas after login, rather than traversing public homepage links.
- Rename auditor website action **Login** to **Profiles** and add vertical scrolling and a constrained height to the profile modal.
- Raise sticky header stacking and show scan warning counts.
- Add a local regression fixture for a Livewire-style asynchronous login, plus pure request-policy tests.

## Installation

This patch applies over `Website_Auditor_Authenticated_Scans_Fixed_20261026.zip` (the authentication patch from the previous turn). It is not designed to apply directly over the older `Archive(3).zip` without first applying that release.

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
git apply --check ~/Downloads/Website_Auditor_Filament_Auth_UI_20261026.patch
git apply ~/Downloads/Website_Auditor_Filament_Auth_UI_20261026.patch
npm run format
npm run lint
npm run test
npm run typecheck
npm run build
npm run test:auth:browser
systemctl --user restart lerd-app-website-auditor.service
systemctl --user restart website-auditor-worker.service
```

For Insure360, configure **Profiles → Root** with login URL `https://insure360.test/cadmin/login` and authenticated start URL `https://insure360.test/cadmin`. Confirm authorized credentials. After updating, create a **new** scan; previously saved scans are immutable historical evidence. If login still fails, inspect `Live scan activity` for the new network/authentication diagnosis, and verify the target in a normal browser. A target-side Livewire/CSRF/session error requires target-side investigation; the auditor will not bypass authentication.

The protected-route heuristic uses the first path segment for nested or known panel roots. A website whose internal navigation legitimately crosses unrelated origins or separate path roots should be registered as separate approved targets or extended with explicit discovery scopes before scanning.

## Verification limits

The source, syntax and pure policy tests were checked in the packaging environment. Full project ESLint/typecheck/build and real browser login against Lerd/Insure360 must run in your local installation. In particular, no credentials, database records or targets were modified here.

---

## Original: `BROWSER_FAITHFUL_DIAGNOSTICS_20261026.md`

# Browser-faithful Livewire diagnostics

## Finding

The existing crawler uses `context.route` to abort requests failing its policy. Even with the optional Livewire compatibility setting enabled, requests were rejected if the browser frame URL was unavailable or the component payload was not the expected Livewire JSON shape. The resulting `ERR_BLOCKED_BY_CLIENT.Inspector` is a scanner-induced failure, not a slow response.

## Changes

- Respect the saved `allowLivewireBackground` setting on each scan (non-production only).
- Accept same-origin, page-initiated Fetch/XHR POSTs to a narrowly scoped Livewire update endpoint without enforcing one framework payload format.
- Fall back to the approved scanned page URL for early requests whose Playwright frame URL is unavailable.
- Persist redacted policy-block reasons and emit the effective policy and concurrency in scan activity.
- Retain strict protection for production sites, arbitrary mutation endpoints, cross-origin traffic, navigation POSTs, and scanner-initiated destructive clicks.

This mode is **not guaranteed read-only**: application-generated Livewire methods may mutate data. Enable only for explicitly authorized local/staging instances with test accounts and disposable data.

## Verify on the actual Lerd host

1. Website Auditor → Websites → Insure360 → Edit: check **Browser-faithful Livewire requests** and Save.
2. Set concurrency to 1 and max pages to 5 for the first test.
3. Restart worker: `systemctl --user restart website-auditor-worker.service`.
4. Start a **new** Root-profile scan. Confirm Live Scan Activity states `Livewire transport: browser-faithful (opt-in enabled)`.
5. In Network evidence, check `allowedBrowserLivewire` and `policyBlockReasons`. The expected `/livewire-.../update` POST must no longer appear under `policyBlocked`.
6. If the Livewire request completes but the temporary-unavailable banner remains, inspect the response code/body and Laravel logs: that is a separate target-side failure.
7. Compare the same route in a manually authenticated browser session. Do not reclassify historical warnings without re-running.

This patch **does not** implement a persistent single browser context across pages; the current worker continues to use a fresh context per route. Any session-lifecycle issues should be analyzed separately after resolving request-policy blocking.

---

## Original: `BROWSER_STABILITY_FIX_20261026.md`

# Browser-faithful Livewire and page readiness

## Why the old scans failed

`net::ERR_BLOCKED_BY_CLIENT.Inspector` with `durationMs: 0` was generated by the auditor calling `route.abort('blockedbyclient')`. No amount of waiting fixes an explicitly aborted request. Also, `DOMContentLoaded` plus a swallowed 3.5s `networkidle` timeout could capture the DOM before Livewire settled.

## Changes

- New **Browser-faithful Livewire requests (local/staging only)** option, disabled by default. Authorizes page-originated, same-origin Livewire POST transport with valid component-shaped JSON, while **not clicking** save/delete/submit actions. It is NOT guaranteed read-only, because application code can mutate data as a background side effect. Use only on explicitly authorized local/staging systems with test accounts and disposable data. Production is blocked server-side.
- Await page `load` and up to 15 seconds of quiet relevant same-origin document/script/styles/XHR/Fetch activity, rather than relying solely on `DOMContentLoaded`/a 3.5 second swallowed `networkidle` attempt. Network quiet is an approximation, not proof that all asynchronous UI behavior finished.
- Save the list of Livewire endpoints permitted by the opt-in mode to the evidence JSON and report the count in scan events.
- Existing strict/passive policies remain unchanged unless the new option is explicitly enabled.

## Apply and verify

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
git apply --check ~/Downloads/Website_Auditor_Browser_Stability_20261026.patch
git apply ~/Downloads/Website_Auditor_Browser_Stability_20261026.patch
npm run format
npm run lint
npm run test
npm run typecheck
npm run build
systemctl --user restart lerd-app-website-auditor.service
systemctl --user restart website-auditor-worker.service
```

Enable the new setting under Websites → Insure360 → Edit, set concurrency to 1 and page limit to 5 for the first scan, then inspect `network.json` and the new scan events. Historical scans are unchanged.

---

## Original: `DISCOVERY_AND_REQUEST_POLICY_FIX.md`

# Website Auditor — request-policy regression and navigation discovery

## Changes

- Browser-faithful regression fixture now requires valid JSON transport, consistent with the security policy.
- The default discovery mode is **Navigation only**. It reads menu/sidebar/header/footer anchors without clicking controls.
- **Navigation + internal content links** is opt-in and may include record detail pages.
- Both modes exclude static assets, Livewire transport, API endpoints and destructive URLs from the crawl frontier.
- Imported route lists also exclude static resources.
- HTTP 404 responses for scripts/stylesheets that a page actually requests remain legitimate network diagnostics. They are not visits to a separate page.
- Existing website registrations use Navigation only when `discoveryMode` is missing; historical scan records remain immutable.

## Verification on the CachyOS Lerd host

Run `npm run format`, `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`, then restart both the Lerd app and the auditor worker. Register or edit an authorized site, choose discovery mode, and run a new scan.

Do not confuse a missing asset (403/404) with a crawled page. If files under `/insure360/build/assets` are requested by the page and 404, check the target's generated asset URLs, public path and build output. The auditor should report that as a subresource issue, not as a navigation visit.

---

## Original: `KNOWN_LIMITATIONS.md`

# Scope and Known Limitations

The package provides implemented application code but is **not a fully verified production release**. Do not present it as feature-complete until these gaps are closed and integration-tested on the intended Lerd installation.

## Incomplete or constrained functionality

1. **No actual Lerd integration verification**: This workspace does not contain the user's Lerd installation, DNS resolver, MongoDB/RustFS instances, `.test` virtual hosts or target credentials. The bundled `.lerd.yaml` follows the documented v1.24 host-proxy form but is untested locally.
2. **Browser trace policy**: Optional traces are saved for suspicious/failed pages when enabled. If tracing is unavailable, page evidence can still exist without a trace. Screenshot capture is best effort on navigational failures.
3. **Live authenticated pages**: Dashboard's live link uses the user's normal browser session. The `npm run live` CLI supports managed headed Playwright sessions with configured credentials. It does not automatically transfer a separate worker's cookies into an unrelated browser or stream the headed browser into the dashboard.
4. **MFA/CAPTCHA**: No bypass is attempted. An interactive, already-authenticated browser can be used separately; full MFA continuation in the automatic worker is not implemented.
5. **Navigation discovery**: The crawler reads rendered anchors and imported GET routes. It does not exhaustively infer JavaScript-only routes, open every menu, safely click all buttons, or exercise forms. Complex SPA components require an explicitly approved scenario DSL and safeguards.
6. **Request safety trade-off**: Crawls block non-GET/HEAD/OPTIONS requests except while logging in; many Livewire/AJAX features use POST for benign UI requests and can be partially blocked. This is deliberate to prevent unintended submissions and transactions.
7. **SSRF defenses**: DNS resolution and exact host/port scope validation are implemented, but there is no hard IP pinning. A DNS-rebinding or proxy-dependent environment may defeat a check between DNS lookup and browser socket open. Use an egress firewall for high-risk deployment.
8. **Error taxonomy**: Captures common HTTP, browser exceptions, failed resources and visible exception screens. Detecting every possible visual regression, every hanging spinner, every framework-specific exception or all request/response bodies is outside its present coverage.
9. **Reports/evidence viewer**: Offline HTML reports include a searchable summary table rather than inline embedded private screenshots. Evidence browser preview is sandboxed, and original/rendered snapshots are conservatively redacted; exact original secret-bearing HTML cannot be promised to remain byte-identical.
10. **Investigation & fixes**: Diagnosis is rule-based with optional Laravel log tail. No LLM source-code fix generation or automatic autonomous debugging is implemented. Admin-provided unified patches can be checked and manually approved. Unit tests and patch rollback are not automatically run after application.
11. **Historical comparison**: Historical page/issue records and a recheck outcome are persisted; there is a basic side-by-side source and screenshot view, but no semantic HTML diff or perceptual screenshot comparator yet. Verification status is issue/URL-scoped, not a full visual regression score.
12. **Scan scheduling**: Fixed minute intervals are supported; calendared cron schedules, blackout windows and per-site working hours are not provided.
13. **Advanced workers**: Atomic Mongo leases and heartbeat recovery exist. Multi-node distributed browser management, hard worker cancellation mid-navigation, fairness quotas, and per-route replay isolation under abrupt crash need load testing.
14. **Retention**: No automatic expiry job or bulk RustFS lifecycle cleanup is implemented; choose a RustFS bucket lifecycle policy and add deletion tooling before long-running large-scale audits.
15. **Application security**: Designed for a single admin on a trusted network. No organization accounts, MFA for dashboard, granular permissions or external-facing reverse-proxy rate limiting is supplied.

## Required before declaring full success

Resolve dependency installation and build; run end-to-end Chromium fixture tests; validate service credentials, persistence, TLS, worker recovery and cancellation on CachyOS/Lerd; test actual target login accounts; perform security review of network requests and patch application; measure memory/runtime/concurrency; and sign off the verification matrix.

### New cleanup and queue considerations (October 25, 2026)

- Host-proxy sites may lack the framework association required by `lerd worker`. The project supplies an opt-in `fish scripts/install-worker.fish` to install a separate systemd user service for the worker. This does not modify other Lerd sites.
- MongoDB remains the queue backend. Beanstalkd and Valkey were considered but are not implemented as alternative queue drivers in this update.
- The in-app Reports view reads paginated MongoDB results for a selected finished scan; this is not a separate real-time HTML export renderer.
- Cleanup operates synchronously in the authenticated API and deletes at most 50 eligible completed scans per execution. Very large S3 evidence sets and slow object storage can exceed an HTTP request timeout; run smaller batches. Missing or failed S3 deletion prevents scan-record removal.
- Cleanup does not provide automatic scheduled retention or deletion of arbitrary databases, site registrations, encrypted authentication profiles, or active queue records. Back up before deletion.
- Inspector/noise classification relies on observed error strings. It does not diagnose all browser extension interference or every network failure; HTTP 200 pages can still fail for real runtime issues.

---

## Original: `LIVEWIRE_COMPATIBILITY_FIX_20261026.md`

# Livewire compatibility and false-positive diagnostics

## Why the error appeared

The original read-only request guard rejected first-party Livewire background `POST /livewire-<hash>/update` requests carrying component calls. Aborting such a request reports `ERR_BLOCKED_BY_CLIENT` to the target application. Filament/Livewire may then display a generic temporary-unavailable banner even if the underlying GET document returned HTTP 200. The existing error grader correctly flagged this as inconclusive, but the browser page itself was left broken by the interception.

## Change

- Site setting: **Allow background Livewire initialization**. Available for authorized **local/staging** sites only; production remains strict and rejects this setting at the API layer.
- When enabled, the scanner allows only passive, page-originated, same-origin hashed or standard Livewire `POST` updates with a bounded JSON body, empty field updates and no obviously mutating method names. No policy bypass for other hosts, HTTP methods, form posts or navigation requests.
- Navigation discovery now reads existing DOM anchors instead of clicking sidebar/menu controls, which could trigger Livewire actions.
- Saved network evidence includes sanitized URLs of permitted background Livewire endpoints and the scanner emits an activity event for them. Passwords, cookies, request payloads and tokens are not exported.
- Opaque JavaScript `Object` errors receive an explicit explanation and remain actionable if not associated with an actual scanner policy block.
- Previous scans are intentionally immutable. Retry affected pages or create a new scan to collect new evidence.

## Security caveat

Livewire methods are application-defined. Their names do **not** prove absence of side effects. Even methods that look read-only can write to the database, and `wire:init` can trigger arbitrary server code. Use compatibility mode only on a **controlled, authorized development/staging site** with a restricted test identity. Back up relevant data first. The auditor intentionally does not click action buttons, save forms, or invoke additional methods for route discovery. If background requests are still blocked, keep the scan inconclusive and inspect the app rather than disabling the guard globally.

## Steps on CachyOS / Fish

1. Apply the patch to the previous `Website_Auditor_Scan_Tracking_Forms_Fixed_20261026` release.
2. Run `npm run format && npm run lint && npm run test && npm run typecheck && npm run build`.
3. Restart Website Auditor dashboard and background worker services.
4. Go to **Websites → Insure360 → Edit**. Enable **Allow background Livewire initialization**, save the site. Lower browser concurrency to **1** during acceptance testing to avoid saturating PHP-FPM.
5. Start a new **Root** authenticated scan with a small page limit, inspect the `/cadmin` route and its network evidence.
6. Confirm the previous blocked Livewire `POST` is now present among permitted requests (and absent from policy blocked requests). If the temporary-unavailable banner persists, treat it as a real target-side issue and inspect Laravel/Livewire logs. Do not modify Insure360 automatically.
7. Leave the setting disabled for production websites and unknown third-party targets.

## Known limitations

- Genuine HTTP/application failures, a broken Livewire backend, rate-limiting, PHP-FPM exhaustion, cross-origin requests, nonempty `updates`, and action-oriented Livewire calls are **not** fixed by this compatibility mode.
- Existing historical scan records remain as captured. Rerunning does not retroactively revise them.
- Framework route discovery no longer clicks collapsed navigation controls. It still collects DOM links (including hidden anchors), but sites that load navigation entries only after clicking require a separately approved discovery mode or route import.
- Unit and syntax checks do not substitute for an end-to-end browser scan against the actual authorized website.

---

## Original: `UPGRADE_20261027.md`

# Website Auditor — 2026-10-27 incremental upgrade

This is an **additive source upgrade** based on the supplied `Archive(4).zip`. Do not treat the upgrade as a validated production release until the full local checks and a live MongoDB/Playwright acceptance test pass.

## Included

- Shared `ActionButton`, `Tooltip`, `Dialog`, `ConfirmDialog` primitives, focus handling, reduced motion, and reusable styles.
- Manual Review screen: legacy finding compatibility, multi-selection, comments, decisions, reopen/return-to-active/rollback, status filter, and atomic append-only `reviewHistory` events.
- Scan rerun: new scan record with optional `rerunOfScanId`, preserved original profile/options/URL mode, optional numeric overrides, active deduplication.
- Bulk retry: selected active issues and scan-scoped failed pages, chunked at 50 items (website-wide eligibility uses a bounded server-side cursor), queue deduplication, no mutation of historical scan results.
- Guarded fixed-unit systemd worker control, read-only status/logs, and log download.
- Diagnostics and Manual Review CSV/JSON/HTML exports. Evidence object keys are NOT placed into unrestricted export files.
- Website profile-name normalization and duplicate checks; profile form shows linked website as read-only information. Profile Archive and Restore retain historical links, encrypted credentials and scan records without deleting them; active scans must finish before archival.
- Read-only `npm run data:check` for collection counts and stable ID digests plus sampled reference checks.
- Existing issue occurrence history is no longer truncated to the most recent 30 entries. Older events that were already truncated cannot be recovered by this change.

## Fish application (no Git commits, branches or worktrees)

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor

git status --short
# Download the patch provided in the same response
# Set path to wherever your browser saved it:
set patch ~/Downloads/Website_Auditor_Management_Review_20261027.patch

git apply --check $patch
git apply $patch
npm ci
npm run format
npm run lint
npm run test
npm run typecheck
npm run build

# Optional, read-only integrity baseline, requires MongoDB
npm run data:check > /tmp/website-auditor-integrity-after.json

# Restart only Website Auditor services after all checks have passed
systemctl --user restart lerd-app-website-auditor.service
systemctl --user restart website-auditor-worker.service
```

The patch does **not** touch `.lerd.yaml` or `.env`, does not automatically migrate or delete records, and does not modify target websites.

## Manual Review & identity

Stored `Issue.status` values (`open`, `reopened`, `manual_review`, `verified_resolved`) are preserved. Additional optional `reviewState`, `reviewVersion`, and `reviewHistory` fields are written only when a reviewer acts. A review event includes a pseudonymous administrator-session ID, timestamp, old/new workflow status, decision, and comment. There is one administrator password; this is **not** a multi-user identity provider or per-person RBAC. A real named-reviewer identity would require user accounts, roles and session identity.

The `return_active`, `reopen`, and `rollback` decisions add a new history entry; they do **not** erase earlier decisions or historical scan evidence. Dismiss/accept/rollback require a comment. The fallback legacy PATCH route also creates review-history records.

## Backend compatibility and upgrade safety

All added document fields are optional, including profile `archivedAt` and scan `rerunOfScanId`. `db.ensureIndexes()` adds a partial unique `{siteId,profileNameKey}` index for profiles and a status lookup index for issues; older profiles with no `profileNameKey` remain valid. There is no destructive migration or collection rename. No manual database backfill is necessary for old issues to enter review.

**Before applying to a live database:** back up the `website_auditor` database and the dedicated RustFS private bucket. Keep the original project ZIP/patch; do not drop the database. Run `npm run data:check` before and after deployment and compare counts/ID digests. Index creation can fail if custom modifications previously wrote duplicate `profileNameKey` values; inspect that issue rather than deleting records.

Example MongoDB backup command (credential supplied interactively):

```fish
mongodump --host 127.0.0.1 --port 27017 --username root --authenticationDatabase admin --db website_auditor --archive=$HOME/website-auditor-backup.archive --gzip
```

Store the backup securely. Use the RustFS web console or an S3-compatible CLI with protected credentials to back up the dedicated evidence bucket separately.

`data:check` is **read-only**. Its reference inspection is a sample of the newest 100 documents per relation, not an exhaustive reference or RustFS object audit. It neither modifies nor repairs mismatches.

## Worker control

Without extra setup, `/workers` provides best-effort read-only host supervisor status and logs. To allow the website's single authenticated administrator to start, stop and restart the fixed user-level unit, set in the **Website Auditor host service environment**:

```dotenv
AUDITOR_WORKER_CONTROL=systemd
```

Restart the Next.js host app service after setting this. Commands are strictly `systemctl --user start|stop|restart website-auditor-worker.service`; no arbitrary command or unit argument is accepted. This requires the app host service to have access to the same systemd user manager. Worker stop behavior depends on the existing unit's `TimeoutStopSec`; an active scan may be interrupted, then recovered through the queue lease.

Do not grant this mode to a publicly accessible shared administrator account without stronger access controls.

## Exports

- `/api/exports/reviews?format=csv|json|html` — decisions, comments, timestamps, IDs and history.
- `/api/exports/diagnostics?scanId=...&format=csv|json|html` — page results, timings, console/network errors and **names** of available evidence types.
- Existing protected HTML/JSON/CSV reports and RustFS evidence views continue unchanged.

The upgrade does not add native Excel (`.xlsx`) or PDF creation. CSV can be opened in Excel, and HTML can be printed to PDF, but those are not equivalent to native file-generation services. For privacy, original screenshots/HTML remain accessible through the authenticated evidence viewer rather than embedded in downloadable CSV/JSON.

## Verification limitations

This environment could not complete `npm ci`; dependency tarballs were missing from cache and online installation timed out. Consequently the full Next.js compile/build, ESLint, `tsx` tests and real browser/MongoDB integration could **not** be certified here. Syntax parsing and focused dependency-free tests were run; see `VERIFICATION_20261027.md`.

After local validation, acceptance tests should cover: rerun always adds a separate scan; concurrent rerun clicks reuse an active scan; old manual-review documents without optional fields; accepting then reopening a finding adds two events; cancellation/worker restart does not lose queued jobs; bulk retry selection in an unfiltered and scan-filtered view; real systemd permission check; dark mode, keyboard focus and mobile modal scrolling; download/reopen of existing private evidence. No recorded historical findings should be marked resolved without a new successful verification.

---

## Original: `UPGRADE_AUTH_20261026.md`

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

---

## Original: `UPGRADE_TRACKING_20261026.md`

# Website Auditor — scan tracking / controls patch

Applies over **Website_Auditor_Filament_Auth_UI_Fixed_20261026.zip**.

## Corrections

- New website registration begins with an empty URL, and errors on invalid host/port values.
- New authentication profiles initialize their login and authenticated start URLs from the selected registered website (edit remains unchanged).
- Website deletion is explicitly confirmed by typing its name. Active scans block deletion, and existing scan history requires a separate opt-in. The endpoint deletes the site's evidence in RustFS before removing its MongoDB records. On RustFS failure deletion is aborted.
- Website → Configure Scan navigates with `?site=...`; Scans filters by site and can deep-link each scan's Routes and Errors.
- Routes and Errors accept `?site=...&scan=...`; a selected scan shows that scan's historical failed page results instead of only the latest issue records.
- Reports exports filtered scan errors to CSV/JSON, with a separate website-wide CSV.
- Scanning captures JS errors with stack detail where possible. If a blocked Livewire update plausibly caused a temporary-unavailable screen or a generic `Object` rejection, the route is **warning/inconclusive**, never silently marked passed. Unrelated HTTP 500 and other independent failures remain failed.
- `Retry Page` differentiates duplicate active verifications from fresh queued verifications.
- Added tracking of saved pages per scan and a full-width information notice for the selected profile.

## Browser behavior

The current implementation uses a headless Chromium browser and a **new isolated browser context/page per audited URL**. This does not change the visible user's browser tab. Each page starts from a verified Playwright storage-state snapshot; dynamic per-page Livewire behavior can differ from normal continuous tab navigation. The patch does **not** claim to have implemented a shared browser-session crawler. A follow-up can add an opt-in, stateful, rate-limited scenario runner with explicit safe actions rather than permitting arbitrary POST requests.

## Verification limitations

This project cannot be connected to your private Insure360/Lerd instance here. The existing 144-failure report is immutable and is not retroactively reclassified. Verify with a new scan, starting with 2–5 pages and concurrency 1, and compare the saved network and browser trace evidence. A genuinely visible exception without an auditor policy block remains a failure requiring target-side diagnosis.

## Install

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
git apply --check ~/Downloads/Website_Auditor_Scan_Tracking_Forms_20261026.patch
git apply ~/Downloads/Website_Auditor_Scan_Tracking_Forms_20261026.patch
npm run format
npm run lint
npm run test
npm run typecheck
npm run build
systemctl --user restart lerd-app-website-auditor.service
systemctl --user restart website-auditor-worker.service
```

The patch does not modify `.env`, `.lerd.yaml`, Insure360, MongoDB contents, or the application's port.

---

## Original: `WORKER_MANAGEMENT.md`

# Website Auditor — One-command Fish worker manager

In the project root, run `fish scripts/auditor.fish setup` to install, verify, enable and start the dedicated systemd user worker, and run connectivity checks.

Other commands: `status`, `logs`, `start`, `stop`, `restart`, `enable`, `disable`, `doctor`, `uninstall`, `help`. Use `fish scripts/auditor.fish <command>`. The worker manager only changes `~/.config/systemd/user/website-auditor-worker.service`. Its `doctor` action is read-only.

The port fix changes `npm run prod` and `npm start` to bind to `0.0.0.0:3100` so the host-side Lerd proxy at `169.254.1.2:3100` can connect. Restart only the website-auditor Lerd app service after applying: `systemctl --user restart lerd-app-website-auditor.service`. Do not expose TCP 3100 to untrusted networks; use host firewall.

Unlike a web server, the scanner worker needs no incoming listener/port. No Beanstalkd/Valkey is required.

If the worker is needed even after logout (without an active login session), investigate `loginctl enable-linger` for the user; do not enable system-wide behavior without deciding this is appropriate.

Note: `npm run build` and the Fish script cannot be fully tested in this execution environment without dependencies and the Fish executable. Verify on CachyOS.
