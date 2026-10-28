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
