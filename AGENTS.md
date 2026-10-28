# AGENTS.md — Website Auditor coding-agent rules

These rules apply to AI coding agents modifying this independent Next.js/TypeScript project. **Inspect the implementation before editing.** The human installation guide is [README.md](README.md).

## Inspect and plan

- Identify the affected UI, `src/app/api`, `src/lib`, `worker`, queue collections, evidence keys, scripts, and tests before changing code.
- Reuse the existing `src/components/ui/`, queue APIs, scan model, MongoDB review workflow, and RustFS storage. Do not create a second queue, worker supervisor, UI toolkit, or update framework.
- Keep source changes limited and preserve unrelated local changes. Never create Git branches, worktrees, or commits.

## TypeScript, React and UI

- Preserve strict TypeScript; correct invalid typing rather than suppressing ESLint or modifying tests to conceal defects.
- Build reusable, keyboard-accessible, responsive UI; prefer named primitives in `src/components/ui/` (Button, IconButton, Dialog, Tooltip, Card, DataTable, and form/status controls). A page-specific component belongs under `src/app/<page>/_components/`; keep one page heading per route.
- Respect light/dark themes, reduced motion, correct modal focus/scrolling, and visible disabled reasons. Confirm consequential actions only.
- Do not introduce a credential-bearing URL, arbitrary code execution, or accidental HTTP mutation into a scan.

## Data invariants

- MongoDB findings, profiles, queue state, scan results, review events, and RustFS objects are user data. Never reset, drop, bulk-delete, or overwrite them while updating code.
- Extend schemas additively. Preserve all historical observation IDs, screenshots, traces, failure evidence, verification references, and Manual Review audit events.
- Resolving a finding requires a _new, real_ passed verification page (2xx, no actionable errors). A queued retry or HTTP 200 with warnings is not a verified resolution. Keep previous failure observations.
- Active Errors and Resolved Findings counts come from MongoDB status queries. Do not infer them from paginated or filtered rows. Report views must work with no website/scan selected, and use a single filter implementation for pagination, distinct HTTP status options and exports.
- Make any required backfill idempotent/resumable. Use `npm run data:check` for read-only reference checks. Require explicit authorization before a destructive operation.

## Updates and verification

- Supported updater: `bash scripts/update.sh --check <update.zip|patch>` then `--apply`. ZIPs require the versioned update manifest and SHA-256 values; ordinary arbitrary ZIPs are not accepted.
- Conflicts must be reported. Do not automatically answer yes to force. `--apply --force` still requires valid manifests, paths, checksums and restorable backups. Never apply unsafe updates to `.env`, `storage`, `.git`, or `node_modules`.
- After edits, run the configured formatter (`npm run format:files -- <changed files>`), then the single gate: `npm run verify`. The gate runs the dependency-free Python updater/deployment safety tests followed by `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build` and writes timestamped logs to `storage/test-reports/verification`.
- Batch totals and active scan counts must be derived from MongoDB, not the paginated browser table. Preserve an optional `batch_requests` selection ledger so newly queued, reused, ineligible, and failed retry selections are separately accounted for. A selected finding is not automatically a new job. Successful update activation requires all relevant supervisor and HTTPS readiness checks; failed or blocked restarts are not a Passed deployment.
- Never delete or weaken a failing test or declare success based on syntax parsing alone.
- Only after successful verification and with appropriate host privileges may the updater restart **the two fixed Website Auditor systemd-user units**. Record unsupported or failed restarts as blockers; verify the HTTPS endpoint and worker status afterwards.

## Environment and operations

- `.lerd.yaml` uses Lerd host-proxy port 3100; Next.js must bind `0.0.0.0` for Lerd's gateway. Keep the Playwright worker independent of Next.js requests.
- Use the existing `scripts/auditor.fish` to manage the fixed systemd worker, `scripts/diagnose-502.fish` for upstream/proxy diagnosis, and `scripts/update.sh` to apply updates. Internal scripts may be separate modules; do not add competing entry points.
- Never access or modify Insure360/Taskloom source or data without a separate scoped authorization.
- Redact URLs, credentials, cookies, session headers and signed evidence links from reports; avoid logging encrypted profile values. Exported developer ZIP evidence is an authenticated, bounded, opt-in private download; saved HTML must remain inert text and screenshots must never be silently included. Do not claim redaction can remove every visible personal detail.

## Documentation and completion

- Keep this file consistent with implemented scripts; update README for operator-facing changes. Consolidate obsolete historical change notes when safe, but retain original historical verification reports and their data under `docs/history/`.
- Generate a concise verification report with touched files, cleanup before/after size, backups/rollback, checks run, migration considerations, service health, and unresolved limitations.
- Report **Passed**, **Passed with Warnings**, **Failed**, or **Blocked** faithfully. Completion requires implementation, tests, lint, typecheck, production build and health checks, or an explicit blocker disclosure.

## Portable encrypted configuration backup

- `src/lib/config-backup.ts` owns the versioned schema, whole-bundle AES-256-GCM encryption/scrypt key derivation, backup validation, and import-plan checks. `src/lib/config-backup-api.ts` integrates the single authenticated API route; `src/app/websites/_components/config-backup-panel.tsx` is the sole Website/Profile import/export UI.
- Never export raw `encryptedPassword` values (not portable between `AUTH_ENCRYPTION_KEY` installations), plaintext passwords, sessions, cookies or unencrypted usernames in the backup envelope. Decrypt profile credentials only in server memory to seal the entire portable backup, then re-encrypt on import using the current installation key.
- Preview must remain read-only; conflict plans, 5-minute signed confirmation, same-origin authorization, and duplicate-submission protections must remain enforced. Create/Update/Skip must preserve site/profile IDs on updates and never mutate `scans`, `pages`, `issues`, review history or RustFS evidence.
- Update `tests/config-backup.test.ts` with any backup schema or encryption change. Do not add unsupported auth methods without an explicit versioned migration plan. Confirm imported credentials work using an authorized test profile; never record them in logs.

### Worker command modes (local)

- `npm run worker` opens a terminal-only numbered action menu (run/status/logs/start/stop/restart/diagnose).
- `npm run worker:run` remains the **non-interactive queue worker** for systemd, service managers and unattended jobs.
- The installed systemd unit may invoke `worker/index.ts` directly and remains compatible. Do not replace that command with the interactive menu.
- Service stop/restart requires an explicit yes in the interactive menu.

### Source cleanup

- First run `npm run cleanup:check` and inspect its exact duplicate-file hash list.
- `npm run cleanup` only removes root Markdown files when an archived byte-identical copy exists; it does not delete scan evidence, data, screenshots, history, or backups.
- Never mass-delete `docs/history/` or `storage/` merely to reduce size.

## Workspace routes and reusable tables

- Routes live in `src/app/<section>/page.tsx`; shared authorization is provided by `src/app/_shared/secured-dashboard.tsx`. Do not reintroduce an unrestricted catch-all route.
- `src/components/dashboard.tsx` still coordinates shared loading and editing state. Extract a page's content into its route-local components when making further changes, rather than duplicating data fetches or controls.
- Use the shared `Card` for metric and website cards. Use `DataTable` with declarative columns, stable row IDs and accessors for sortable fields. Actions and selection controls are not sortable; large paginated datasets require server-side sorting, not a misleading sort across only one loaded page.
- Legacy MongoDB optional profile fields may be `null` or empty. The portable backup serializer must omit only these optional fields without altering stored records, credential encryption or login scope validation.

## Next.js route migration validation

After adding or deleting App Router entry points, run `npm run typecheck`, not bare `tsc`, before `npm run build`. The command clears only generated `.next/types` and `.next/dev/types` and invokes `next typegen` before TypeScript validation to avoid old validators referencing deleted routes. Run typecheck/build serially rather than alongside a running Next build. Do not delete application source or evidence to resolve generated-type errors.

## Destructive-action UI

Use `DestructiveButton` from `@/components/ui` for Delete/Archive/Remove actions. The default quiet style is suitable for cards/tables; `emphasis="strong"` is reserved for confirmed operations in a dialog. Never execute a destructive endpoint directly from a card action; first show the existing confirmation flow. For icon-only actions use `IconButton` with a tooltip.

## Table and responsive UI conventions

For paginated data, use `DataTable` with controlled `sortState`/`onSortChange` and a strict server-side field allowlist; never sort only the visible page while implying global sorting. Columns backed by derived values without a corresponding safe server implementation must be marked nonsortable. Keep desktop actions coherent and mobile layouts horizontally scrollable with readable labels.

### Active-finding grouping and UI affordances

Group findings for display by normalized detected problem, not by route or scan ID; retain
individual IDs, timestamps and evidence. Preserve the distinction between HTTP status codes
(e.g. 500 versus 502), and label any client-side limited collection as a loaded subset.
Use shared ActionButton/IconButton, Tooltip, DataTable, Card and Dialog for new controls.
Every actionable element requires pointer and focus states; do not make noninteractive cards
appear clickable. Test hover, active, disabled, mobile overflow and keyboard navigation locally.

## Shared overlay and responsive controls

- For a right-hand diagnostics drawer use the exported `SlideOver` from `@/components/ui`. It shares the same underlying `Dialog` focus trap, Escape handling, body scroll lock, backdrop rules and focus restoration. Never create an unmanaged `fixed inset-0` overlay.
- Do not call `window.confirm()` or the global `confirm()` for application actions. Use `ConfirmDialog` for explicit approvals and let `Dialog` handle unsaved-change confirmation internally, including Escape and backdrop dismissal.
- Keep Overview worker status, review links, KPI cards and analytics in **separate full-width sections**. Do not place KPIs or trends inside a flex-wrapped review toolbar.
- Website card buttons must occupy four equally sized cells in a single row without horizontal scrolling. Hide decorative button icons inside narrow cards, not the visible text labels.
- In the diagnostics slide-over, keep request search, type and sort controls on one row when there is space; stack only at small viewport widths.
