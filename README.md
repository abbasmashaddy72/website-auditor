# Website Auditor

Independent, authorized website diagnostics on Next.js, React, TypeScript, Tailwind CSS 4, MongoDB, RustFS, and host-native Playwright. Supports Lerd `.test` sites, permitted localhost/LAN endpoints and HTTPS websites. The target application's code is not modified by ordinary scanning.

## Prerequisites and local development

- Node.js 22, npm, Lerd host-proxy, MongoDB, RustFS (S3-compatible), and Playwright Chromium.
- Fish for the worker manager; bash and Python 3 for the verified updater; systemd user units on Linux for production worker supervision.
- Copy `.env.example` to `.env`; configure your **own** MongoDB/RustFS credentials, admin password, session secret and encryption key. Never check `.env` into Git.
- Match `.lerd.yaml` host proxy `port: 3100`, and production `HOST=0.0.0.0`, `PORT=3100`. Keep the local reverse proxy and worker separately supervised.

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
npm ci
npx playwright install chromium
npm run build
lerd link
fish scripts/auditor.fish setup
npm run doctor
```

Visit `https://website-auditor.test`. First register an authorized website under **Websites**, configure its approved host/port scope, then create any required auth profile on that site's card. On **Scans**, select the site/profile; authenticated crawls verify login and restrict discovery to the approved panel area. Observe queue progress, Routes, Active Errors, Resolved Findings, Manual Review and Reports.

## Main commands

| Command                                      | Purpose                                          |
| -------------------------------------------- | ------------------------------------------------ |
| `npm run dev`                                | Local dashboard, port 3100                       |
| `npm run prod`                               | Start prebuilt Next.js server for Lerd           |
| `npm run build`                              | Create production build                          |
| `npm run worker`                             | Interactive worker actions (terminal only)       |
| `npm run worker:run`                         | Unattended foreground worker for process manager |
| `npm run cleanup:check`                      | Preview duplicate historical Markdown files      |
| `npm run cleanup`                            | Remove only byte-identical archival duplicates   |
| `npm run worker:manage -- status`            | Inspect managed worker and app                   |
| `npm run worker:manage -- setup`             | Install/enable/start systemd user worker         |
| `npm run worker:manage -- logs`              | Follow worker journal                            |
| `npm run scan -- --site https://example.com` | Authorized CLI crawl                             |
| `npm run scan:status`                        | CLI scan status                                  |
| `npm run routes:import`                      | Import explicitly scoped browser pages           |
| `npm run data:check`                         | Read-only MongoDB integrity sample               |
| `npm run doctor`                             | CLI diagnostics                                  |
| `fish scripts/diagnose-502.fish`             | Dedicated Lerd nginx/502 diagnostics             |
| `npm run format`                             | Prettier formatting                              |
| `npm run verify`                             | Single verification gate and timestamped report  |

Use `npm run dev:all` for temporary foreground development, **not** alongside the supervised production worker. The service unit is `website-auditor-worker.service`; inspect with `systemctl --user status website-auditor-worker.service`.

## Updates, verification, and rollback

The sole update entry point is `scripts/update.sh` (Git unified patches or **manifest-based** ZIPs, not arbitrary source archives):

```fish
bash scripts/update.sh --check ~/Downloads/update.patch
bash scripts/update.sh --apply ~/Downloads/update.patch
# Only after reviewing conflicts and approving replacement:
bash scripts/update.sh --apply --force ~/Downloads/update.zip
```

An update ZIP must include `update-manifest.json` (version 1) and `files/<path>` members whose SHA-256 values match the manifest. Supported operations are add, modify, delete and rename. `--check` never changes source; `--apply` backs up affected files under `.auditor-backups/`, formats touched source files, then calls the single verification script before allowed service restarts. The updater never resets MongoDB or RustFS. Git patches with incompatible hunks require manual reconciliation; force cannot override unsafe paths, invalid content, or missing patch context.

```fish
npm run verify
# equivalently: bash scripts/verify.sh --format  (format then validate)
# Restore file backups after inspecting the update rollback manifest:
python3 scripts/update.py --rollback .auditor-backups/<id>
```

The verification gate includes updater archive safety and deployment-health regression tests before the TypeScript quality checks. A successful build **does not** mean deployment succeeded: inactive service units, failed restarts or failed HTTPS readiness are returned as deployment blockers/failures; no database rollback is performed.

Timestamped verification logs live in `storage/test-reports/verification/`. Update backups and `ROLLBACK.txt` live under `.auditor-backups/<id>/`. Perform external database and RustFS backups before risky deployments; the source updater does not back up live services/data. Review reported service/HTTPS blockers instead of assuming success.

## Scanning and privacy

The worker persists queue leases and page results to MongoDB, private HTML/screenshots/traces to RustFS, and review decisions as appended audit events. A passed targeted retry may mark an active finding **verified resolved**, preserving its original evidence; unconfirmed retries never remove errors. Navigation-only discovery is the default; never crawl arbitrary file URLs, logout links or write operations.

The local/staging browser-faithful Livewire option permits page-initiated component requests which **may have side effects**. Enable only for explicitly authorized disposable test environments. Use verified TLS on production sites, rate limits and minimal scan concurrency. Profiles remain isolated.

Reports open with **All websites / All scans** selected by default. Use optional Website, Scan, UTC date, result and unique HTTP-code filters; download matching HTML, CSV, JSON or XLSX diagnostics without selecting an individual scan. A specific scan also offers its original immutable report. Historical page observations are never changed by report filtering.

Reports support HTML, JSON, CSV and dependency-free native XLSX for page diagnostics, failed-page evidence, and Manual Review history (up to 10,000 records per workbook). For developer troubleshooting, **Developer evidence ZIP** provides a mapping between up to 100 selected page diagnostics and their available rendered/original HTML (inert text), network/console JSON, and optional screenshots. The ZIP requires dashboard authorization and is bounded to 25 MB by default. Filtering down to 100 pages or fewer is required; an explicit error explains oversized scopes. Screenshot evidence and even redacted HTML can contain private information: inspect before sharing. PDF rendering and full interactive-browser regression automation still require further implementation and verification. Evidence remains access-controlled and is not bundled in unrestricted JSON reports. The host manager must be authorized before enabling `AUDITOR_WORKER_CONTROL=systemd`.

Agent coding rules: [AGENTS.md](AGENTS.md). Historical verification reports remain as original files under [`docs/history/`](docs/history/); earlier non-verification release notes are consolidated in [the historical release archive](docs/history/RELEASE_ARCHIVE_20261026-27.md).

## Portable encrypted Website + Profile configuration backup

Under **Websites → Configuration backup**, choose **Export** to download a _single_ versioned encrypted JSON file containing the selected websites (or all websites when none are selected), scan settings, login URLs, account identifiers, profile selectors, and passwords. The entire configuration is encrypted on the server using AES-256-GCM with a random IV, scrypt-derived key, and random salt. A distinct **backup password of at least 12 characters** is required; it is **not saved**, and the export cannot be restored without it. Store the encrypted file and password in separate secure locations. Profiles with archived status are included.

Choose **Import**, provide the encrypted JSON and its password, and select one strategy:

- **Skip duplicates (default):** Existing website URLs and their profiles remain unchanged; new websites are created.
- **Update existing:** Existing websites are matched by normalized base URL and profiles by normalized name within their website. Existing MongoDB IDs, scan results, findings and RustFS evidence stay intact. Website/profile settings and encrypted login passwords are updated.
- **Create new only:** Import only previously unknown website URLs. Existing URLs are explicit conflicts, not duplicated.

The **Preview** operation is read-only: it checks the archive, decrypts it in server memory, and lists intended create/update/skip actions without revealing login names or passwords. Review the changes, then **Confirm import** within five minutes. Import confirmations are single-use, and applying requires the same encrypted file, password and strategy. Configuration import never writes scan history, issue history, stored reports or RustFS objects. Imported profiles are re-encrypted using this Website Auditor installation's `AUTH_ENCRYPTION_KEY`.

Backups are compatible with the supported password-login profiles; other authentication methods are not invented or silently translated. The API supports at most 50 websites, 100 profiles per website and 2 MB of decrypted configuration data per backup. Invalid, malformed, tampered, or oversized files are rejected. Imports are _not_ intended to act as a live scan: new configuration is saved without starting a Playwright worker. Follow the normal authorized scan workflow afterwards.

**Operational caution:** The current standalone MongoDB deployment may not support cross-collection transactions. If an import fails partway through, the endpoint reports applied counts; inspect the existing configuration and run a fresh Preview before attempting a follow-up import. It will never roll back or delete historical scans automatically. Before updating existing passwords in bulk, export and store a fresh encrypted backup.

The endpoints are authenticated same-origin POST operations: `/api/config-backup/export`, `/api/config-backup/preview`, and `/api/config-backup/apply`. Never send backup passwords in URLs, issue reports, or CI logs.

## Recent 2026-10-27 continuation: batch accuracy and privacy

- **Active Errors** is the default `/api/issues` view and excludes Manual Review and independently verified resolutions. `/api/issues?status=all` explicitly includes historical statuses. The sidebar counts come from MongoDB, not a partial page list.
- **Batch scan totals** are grouped server-side by `batchId`: queued, running, paused, completed, failed, cancelled and measured page counts. The Scan History table loads a recent result window, and expanding a batch can fetch additional jobs in pages of 100. The recent-batch menu counts cover the latest 200 batch groups, not the entire lifetime of the database. Individual scan records, logs and evidence are unchanged.
- **Diagnostic exports** redact query secrets inside the nested performance/resource waterfall, in addition to outer URLs and error text. Do not treat unrestricted exports as access-controlled screenshot backups.
- **Updater activation** now returns a failure or blocker if an enabled systemd user unit cannot be restarted or the application's HTTPS readiness check fails. The quality gate includes dependency-free Python updater/deployment checks before lint, tests, typecheck and build. Restart validation does not alter MongoDB or RustFS.
- This release is **not live-verified** without a successful installation of npm dependencies and an authorized Lerd/MongoDB/RustFS environment. See the dated verification report for open work.

## Excel export compatibility

The Reports and Manual Review panels provide XLSX downloads. Spreadsheets contain sanitized report fields and literal text cells only (never user-supplied Excel formulas). The XLSX output is ZIP/XML-based and does not bundle private screenshot objects. Narrow filters if the request exceeds 10,000 records. Individual cells over Excel's 32,767-character limit are visibly truncated with a reference to the complete JSON export. Do not use XLSX as a substitute for a complete private RustFS evidence backup.

## October 28 interface and batch-accounting refinements

- Overview shows five KPI cards in one row on wide screens. Performance graphs use `/api/analytics` (MongoDB totals for the selected seven- or 30-day period) rather than only the first dashboard result page; unavailable aggregation displays an explicitly labeled sampled fallback. All websites are selected by default, with per-website comparisons.
- Scans moves **Start scan** to the right of its form row. Website Create/Edit now uses the shared scrollable Dialog with fixed actions; Escape/Cancel warns only for actual unsaved changes.
- Reports downloads run through a scoped Blob download handler. Download failures appear alongside exports; intermittent 2.5-second background polling failures are a separate nonfatal status, not false export failures. The `Developer evidence ZIP` includes a `manifest.json` and page mapping, and never modifies stored RustFS objects.
- Batch retries distinguish **selected**, **new jobs**, **reused active**, **ineligible** and **failed** items. Selections are appended to a new `batch_requests` collection, independent of scan results; a selection can legitimately reuse an active job and therefore not produce a new scan record. Existing batches remain readable without this optional tracking data.
- Historical implementation notes were consolidated into one archived Markdown file; historical verification reports remain in place. No MongoDB or RustFS cleanup is part of this source upgrade.
- Full acceptance of React interactions, reports, worker health, MongoDB queries and on-host production build must run on the Lerd machine.

### Worker command modes (local)

- `npm run worker` opens a terminal-only numbered action menu (run/status/logs/start/stop/restart/diagnose).
- `npm run worker:run` remains the **non-interactive queue worker** for systemd, service managers and unattended jobs.
- The installed systemd unit may invoke `worker/index.ts` directly and remains compatible. Do not replace that command with the interactive menu.
- Service stop/restart requires an explicit yes in the interactive menu.

## Frontend architecture (local development)

- `src/app/page.tsx` is Overview. `src/app/{websites,scans,routes,errors,resolved,manual-review,reports,settings,workers}/page.tsx` provide explicit protected workspace routes.
- `src/app/<section>/_components/` holds section-specific UI such as Website cards, configuration backups, Manual Review and Reports. `src/app/_overview/` contains overview-only analytics.
- `src/components/ui/` contains separately maintained ActionButton, IconButton, accessible Dialog/ConfirmDialog, Tooltip, Card, FormField, Tabs, StatusBadge/Alert, and DataTable. Import from `@/components/ui`.
- `DataTable` takes an array of rows, a stable row key, and column headers/accessors/render functions; Routes, Active Errors, Resolved Findings, Reports, and Manual Review now share it. Supported columns sort their currently loaded rows with accessible buttons. For paginated reports, this is explicitly a **current-page sort** until server-side sort/filter is implemented. Action columns are not sortable.
- Configuration export normalizes _legacy optional_ profile URL/selector fields that may be stored as `null` or blank; required passwords and authorized target URLs remain strictly validated. Original MongoDB records and RustFS evidence are not changed by serialization.
- Browser acceptance is performed on the user's Lerd host: `npm run format:check && npm run lint && npm run test && npm run typecheck && npm run build`, followed by real profile export/import and Manual Review keyboard/viewport checks.

### Route type generation after UI page migrations

`npm run typecheck` regenerates Next.js route types after clearing only generated type folders. This prevents `.next/types/validator.ts` from importing removed route files such as `[[...section]]/page.tsx`. It does not remove the Next.js cache or database records. Run validation and build sequentially.

### Shared UI actions and report sorting

Website cards, profile archives, scan cancellation and retention cleanup use shared destructive button styles and their existing confirmation workflows. `DestructiveButton` defaults to a quiet outline on a card; only the final confirmation uses a solid danger style. The shared `DataTable` supports local sorting for loaded datasets and controlled server sorting for paginated datasets. The Reports page uses a whitelist of database-backed sort fields, while columns such as Actions and derived Issues remain intentionally nonsortable.

### Findings grouped by detected issue

In **Active Errors → Detected issue groups**, findings are grouped by normalized category and
message (for example, `http: Main document HTTP 500`). Distinct HTTP response codes do not
merge. Expand a group to inspect affected routes, or select the group to act on its existing
finding IDs. No MongoDB findings, audit history, or RustFS evidence are consolidated or deleted.
Grouping operates on the currently loaded and filtered findings, not an implicit database-wide
count. Server-side active/resolved totals remain authoritative.

Website-card Scan, Profiles, Edit, and Delete actions share a single horizontal action row.
On narrow screens the row scrolls horizontally rather than wrapping. Buttons use common hover,
pressed, keyboard focus, and disabled visual states in both themes.

## Historical HTTP status classification (local-only, opt-in)

The live Routes table now includes **All, Successful, Warnings, Failed, Resolved** tabs with server-derived counts, filtering, pagination, and server sorting. Successful responses with only recognized non-fatal audit findings are warnings; browser/runtime/network failures remain failures even with HTTP 200. Resolved is specifically a newly verified successful observation linked to a `verified_resolved` finding, not merely an HTTP 200.

The existing scanner reports are immutable evidence. To preview safe classification corrections without modifying MongoDB:

```bash
npm run data:check > /tmp/website-auditor-before.json
npm run data:classification:preview
```

Review `eligible`, `ambiguousRequireReview` and `skippedActiveScan`. Only with a current database backup and authorization:

```bash
npm run data:classification:apply
npm run data:check > /tmp/website-auditor-after.json
npm run verify
```

The migration is additive/idempotent: it preserves page IDs, screenshots, issue/review history, and existing RustFS reports, appends classification-audit events, and updates affected completed scan totals/statuses. It backfills warning-only findings only for the latest observation of each site/profile/route; older resolved findings are never automatically reopened. A private original-value backup and a timestamped summary are written under `storage/test-reports/migrations/`. The preview alone makes **no data changes**. Ambiguous 2xx failures (`Object`, unexplained framework errors, unconfirmed runtime exceptions, no supporting issues/warnings) are **not** silently downgraded; they require an independently verified retry. Historical static RustFS reports remain unchanged as originally generated.

New warning and error badges derive from the same MongoDB active finding records; the Route counts endpoint reads all matching records and is not constrained by the dashboard's limited page cache. Routes and active-finding counts refresh after actions and on the existing 2.5-second polling cycle. Do not reset MongoDB or RustFS to correct counts.

### Read-only action and pagination discovery (2026-10-31)

Crawl scans now inspect a bounded sample (up to eight) of menu triggers, including Filament table row action dropdowns, and one nested submenu level. Visible, scoped, safe GET links from Edit/View/Create menus are queued as normal pages, deduplicated and constrained by depth/page limits. GET pagination anchors and a bounded sample of explicitly declared Livewire `gotoPage` / `nextPage` query routes are also discoverable; the auditor **does not invoke Livewire component methods** to paginate.

The scanner never presses Delete, Save, Submit, Pay, bulk actions or unknown record-action buttons. Livewire-only modal/drawer actions are retained as `discoveredInteractions` with `executed: false` and are **not considered tested or visited**. Menu inspection denies non-GET requests even if optional background compatibility is enabled, but site operators must still authorize targets with caution: target-side JavaScript/GET handlers may have side effects that cannot be proven away by the auditor. Scans remain limited to configured approved hosts, ports, and authentication profiles.

`progress.discovered` is the number of known distinct routes (visited, skipped, or pending); `progress.visited` is the number of persisted page observations; `progress.skipped` denotes known ineligible or blocked routes; pass/warning/fail counts partition **pages**, not individual active finding records. The Active Errors badge counts current `open` and `reopened` finding records across historical scans. Manual Review and verified resolutions remain separate. Refreshing a page does not erase prior scan or finding evidence.

An HTTP 401/403 response to an unauthenticated scan is treated as an expected authentication warning only if the response explicitly presents an authentication challenge. Generic 4xx and every HTTP 5xx remain failures; genuine runtime exceptions also remain failures even when the document returns HTTP 200. Historical records are unchanged; use the existing classification migration preview and manual review workflow before making historical corrections.

**Verification:** Inspect at least one authenticated Filament 5 policy listing, dropdown Edit link, pagination URL, Livewire-only modal action, and unauthenticated protected page in your staging environment. Since Livewire component-specific pagination can be held entirely in server session state, GET query sampling might not reproduce the same page. This mode intentionally does not attempt side-effectful Livewire pagination calls.
