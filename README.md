# Universal Website Auditor

A standalone Next.js App Router and Playwright website diagnostic platform. Run on the **host machine** alongside Lerd, inspect approved `.test`, loopback, private LAN and public websites, and store structured results in MongoDB and private files in RustFS. The dashboard and scanner do not need to be installed into, or modify, audited websites.

> **Status:** Substantial installable implementation; local environment and full integration verification are **not completed**. See [VERIFICATION.md](./VERIFICATION.md) and [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) before relying on it. Do not treat this archive as independently certified production software.

## Architecture

```text
Browser -> HTTPS website-auditor.test -> Lerd nginx -> host-native Next.js
                                              | MongoDB (sites, scans, queue leases, pages, issues)
                   dedicated npm run worker ---| RustFS (HTML, PNG, traces, reports)
                                              | host DNS / Lerd .test / localhost / LAN / public

Audited website --> browser-based GET crawl, optional authenticated session --> evidence
Local project source (opt-in) --> read-only investigation --> approved Git diff --> retry
```

### Requirements

- CachyOS Linux with existing Lerd 1.24+ (host-proxy capability).
- Node 22, npm, Fish; Chromium dependencies required by Playwright.
- Lerd's MongoDB **preset** installed and running; RustFS built-in service running.
- Host DNS resolves your own `.test` domains; the worker must run in the **host network environment**, not a new container.
- Independent dedicated MongoDB database and private RustFS bucket with credentials stored only in `.env`.
- Administrator approval for _every_ target; allowlisted hosts, ports, redirects and loopback/LAN scopes are enforced.

## Installation on Fish

This bundle unpacks to `website-auditor/`. If you saved the download in `~/Downloads`:

```fish
mkdir -p ~/Documents/Project-Sites/Local
unzip ~/Downloads/website-auditor.zip -d ~/Documents/Project-Sites/Local
cd ~/Documents/Project-Sites/Local/website-auditor

node --version
npm --version
lerd --version
lerd service list

# Only if MongoDB isn't already installed with Lerd:
lerd service preset mongo
lerd service start mongo
lerd service start rustfs

cp .env.example .env
# IMPORTANT: edit .env and enter real, private S3 credentials and independent secrets.
openssl rand -hex 32   # Copy output to SESSION_SECRET
openssl rand -hex 32   # Copy a DIFFERENT output to AUTH_ENCRYPTION_KEY
openssl rand -base64 32  # Use as AUDITOR_ADMIN_PASSWORD
nano .env

npm install
npx playwright install chromium
# If Chromium is missing system libraries, follow Playwright's Linux dependency instructions.

npm run test
npm run typecheck
npm run lint
npm run build

# Link only this directory; Lerd supervises 'npm run prod' using host proxy.
# Review the Lerd command approval prompt before consenting.
lerd link website-auditor
lerd secure

# Run separately in a second Fish terminal:
npm run worker

# Open HTTPS dashboard. Sign in with AUDITOR_ADMIN_PASSWORD.
lerd open
```

Expected local UI: `https://website-auditor.test`. **Lerd does not automatically run the independent Playwright worker** merely because the proxy site is linked; the worker must be supervised separately. `npm run prod` expects a compiled `.next` build; run `npm run build` before linking or restarting its Lerd host-proxy service.

### Recommended background worker under systemd --user (Fish)

```fish
cd ~/Documents/Project-Sites/Local/website-auditor
mkdir -p ~/.config/systemd/user
set -l npm_path (command -s npm)
set -l node_bin_dir (dirname (command -s node))
set -l root (pwd)
printf '[Unit]\nDescription=Website Auditor Playwright Worker\nAfter=network-online.target\n[Service]\nType=simple\nWorkingDirectory=%s\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\nExecStart=%s run worker\nRestart=always\nRestartSec=5\n[Install]\nWantedBy=default.target\n' "$root" "$node_bin_dir" "$npm_path" > ~/.config/systemd/user/website-auditor-worker.service
systemctl --user daemon-reload
systemctl --user enable --now website-auditor-worker.service
systemctl --user status website-auditor-worker.service
journalctl --user -u website-auditor-worker.service -f
```

This unit belongs exclusively to the auditor. No service units belonging to Insure360, Taskloom or other sites are edited.

### Lerd configuration

Bundled `.lerd.yaml`:

```yaml
domains:
  - website-auditor
secured: true
node_version: '22'
proxy:
  command: npm run prod
  port: 3100
services:
  - mongo
  - rustfs
```

The structured proxy format matches the supplied, working Taskloom project and explicitly reserves port 3100 for Website Auditor (Taskloom remains on 3000). Verify your installed Lerd version and settings before linking. If your installed Lerd supports only a different schema, use that verified schema. The bundled configuration deliberately does not add `Containerfile.lerd`: containerization can break loopback and custom `.test` domain access.

### MongoDB & RustFS configuration

- Lerd's documented MongoDB host access: `mongodb://root:lerd@127.0.0.1:27017/?authSource=admin` for a **local preset**. Use dedicated DB credentials rather than defaults for anything shared or production. `MONGO_DATABASE=website_auditor` is separate from target applications.
- Lerd-managed RustFS exposes an S3-compatible endpoint. The `.env.example` uses `http://127.0.0.1:9000` as an example only: **verify the port, access/secret keys, and reachable endpoint in your Lerd services view**. Create a private bucket or allow the worker to create one using sufficient permissions. Prefer dedicated scoped keys.
- Never commit `.env`; do not put service credentials in `NEXT_PUBLIC_*` variables.
- Development certificates: trust the Lerd CA on the host running Playwright. Enable **Ignore invalid TLS** only for a specifically approved development site when required. Production site registration rejects this option.
- `LOCAL_SOURCE_ROOT` is optional. Set to a parent path explicitly approved for reading/editing local projects; leave empty to disable investigation and code changes.

## Running modes

| Command                                                                                          | Function                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `npm run dev`                                                                                    | Next.js development dashboard                                                      |
| `npm run prod` / `npm start`                                                                     | Host-native compiled Next.js dashboard                                             |
| `npm run worker`                                                                                 | Dedicated persistent Playwright worker                                             |
| `npm run dev:all`                                                                                | Dashboard and worker in the same terminal for development                          |
| `npm run build`                                                                                  | Production build                                                                   |
| `npm run typecheck` / `npm run lint`                                                             | TypeScript and ESLint checks                                                       |
| `npm run test`                                                                                   | Isolated unit tests                                                                |
| `npm run scan -- --site https://insure360.test`                                                  | Queue a registered site's crawl                                                    |
| `npm run scan -- --site http://localhost:5173`                                                   | Queue registered localhost crawl                                                   |
| `npm run scan:status -- --id SCAN_ID`                                                            | Check scan progress                                                                |
| `npm run scan:retry -- --scan SCAN_ID`                                                           | Queue verification of failed pages from prior scan                                 |
| `npm run routes:import -- --site https://insure360.test --file ./routes.json`                    | Import approved safe URLs                                                          |
| `npm run doctor -- --site https://insure360.test --allow-local`                                  | Check Mongo/RustFS/target resolution                                               |
| `npm run live -- --site-id SITE_ID --url https://insure360.test/private --profile-id PROFILE_ID` | Open managed headed Playwright browser                                             |
| `npm run fixture`                                                                                | Start isolated HTTP 200/403/404/500 and JS-error fixture service on 127.0.0.1:8877 |

All custom CLI commands accept `--help`. CLI overrides: `--max-pages`, `--depth`, `--concurrency`, `--timeout`, and `--profile`. Use `--wait --format html|json|csv` to export an offline report into `exports/` after a dedicated worker finishes; `--output` changes the filename. For an **unregistered** site, the CLI requires `--authorize` as an explicit permission acknowledgement; for a loopback / `.test` site also specify `--allow-local`:

```fish
npm run scan -- --site https://insure360.test --authorize --allow-local
npm run scan -- --site http://127.0.0.1:8877 --authorize --allow-local --depth 2
npm run scan -- --site https://example.com --authorize --depth 2
```

Your host's `.test` resolution works through Lerd; no source changes or special code branches are required to add more sites. The worker checks the approved host/port/DNS scope per request and blocks redirect and resource requests outside that scope. Add necessary CDN hosts only when approved. Requests other than GET/HEAD/OPTIONS are blocked during scans. In the explicit login phase, POST is limited to the configured login path or recognized Livewire update endpoints. Some Livewire and SPA features that require POST requests may therefore be incomplete in read-only scans; see limitations.

## Functional workflow

1. **Sign in** at `https://website-auditor.test`. The dashboard is administrator-restricted.
2. **Websites → Add website**. Enter exact base URL, environment, approved host/port scope and local/LAN access settings. Check the explicit authorization box.
3. Optional: **Add auth profile** for each user role. Configure login URL, username/password and selectors; passwords are AES-256-GCM encrypted before storage. Multi-factor login requiring manual action is not automatically bypassed.
4. **Scans** → select website/profile → **Start scan**. A MongoDB queue record is created and the host-native worker claims it atomically.
5. **Routes/Errors** → inspect actual HTTP status, browser/runtime errors, screenshot, original/rendered redacted HTML, or download private network evidence.
6. **Open live** opens the route in the current browser (subject to its _own_ session). For authenticated, independently managed browser inspection, use `npm run live ...` with a registered profile.
7. **Investigate** uses optional authorized local code path, the relevant Laravel log tail and rule-based diagnosis. You may paste a unified Git diff, validate with `git apply --check`, and apply only after explicit approval; a backup is saved under `.auditor-backups/`. No automatic source modification is performed by scans.
8. **Retry page** or `scan:retry`: runs a new authenticated browser check. Open issues are only marked verified resolved after a real passed visit. Historical page results and issue history are retained.
9. **Reports** → download offline HTML, JSON, CSV scan reports. HTML reports include counts, timings and searchable route/error summaries; private evidence stays behind dashboard access.

### Route imports

`npm run routes:import` accepts JSON arrays of URL strings or Laravel `route:list --json` records (`uri`, `method`), CSV (URL in first column) and text (one route per line). GET routes are eligible; API routes, unresolved `{id}` parameters, dangerous action names, cross-host routes and duplicates are skipped. Imports create bounded background scans instead of asking the dashboard to run URLs synchronously.

### Local targets and browser reachability

| Target                          | Worker requirements                                                           |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `https://insure360.test`        | Lerd DNS and trusted CA; authorize loopback; confirm virtual host exists      |
| `https://broker.insure360.test` | Explicitly approved hostname, correct Lerd vhost, matching account profile    |
| `http://localhost:3000`         | Server listening on worker host and port 3000 authorized                      |
| `http://127.0.0.1:8000`         | Explicit local permission; app listening on port 8000                         |
| `https://192.168.1.10:8443`     | Private/LAN permission, port 8443, valid certificate or per-site dev override |
| `https://example.com`           | Public DNS, certificate validation on, approved host and external permission  |

Host-native workers intentionally resolve these names using the _same host resolver_ as the browser developer workstation. If you later containerize workers, you must separately solve container DNS and host networking; `localhost` in a container is **not** the host.

### Security design

- **App login**: server-side administrator password, signed HTTP-only cookie with 24-hour expiry, strict SameSite and mutation origin checks.
- **Credentials**: site login passwords encrypted with AES-256-GCM, independent 32-byte hex key; never in public API responses or exported reports.
- **Target validation**: http/https only; exact approved hosts and ports; DNS checks for private/loopback ranges and metadata IP bans; initial/redirect/subresource checks; no destructive click exploration.
- **Evidence**: private RustFS keys, authenticated API, strict viewer sandbox, redaction of common secrets. Screenshots and page HTML can still contain confidential content; limit administrator and bucket access accordingly.
- **Local changes**: optional `LOCAL_SOURCE_ROOT`, source-only patch paths, `git apply --check`, approval, local backups and rollback preparation.
- **Defense-in-depth needed**: network-level outbound firewall rules and DNS pinning/proxy are still recommended against DNS rebinding. Single-administrator deployment is the intended use, not Internet-exposed multi-tenancy.

### Verification

Run unit tests, build, and then the fixture procedure in [VERIFICATION.md](./VERIFICATION.md). This bundle was generated in a sandbox without Lerd or package registry access: its integration behavior **has not** been verified on your machine.

## Queue visibility, authentication origins and Auto pages (October 2026 update)

- The **Scans** page now polls a live MongoDB-backed activity feed every 2.5 seconds, shows worker heartbeat health (5-second ticks), flags a queued scan when the worker is offline, and surfaces startup errors. Select the terminal icon on a scan for its latest 120 events. Events expire from MongoDB after 14 days; scan history, screenshots and reports retain their existing retention policy.
- Run `npm run worker` as a separate foreground process for diagnosis, or install the optional user service described above. Lerd's PHP `workers: [horizon]` does not start a Node/Playwright worker.
- **Queued** cancellation is immediate; **running** cancellation is cooperative (checks between batches) and an active page can take up to its navigation timeout. Pause also takes effect between batches. All actions report success/failure in the dashboard.
- Duplicate scans with the **same site, auth profile, mode, URLs and explicit scan options** reuse the active scan ID. The MongoDB partial unique index protects simultaneous clicks. Already-existing historical scans are preserved. If a website is reconfigured while a scan is active, let the previous scan finish or cancel it before starting a new one.
- **Page limit = Auto (`0`)** scans all discoverable authorized pages subject to crawl depth, `AUTO_PAGE_SAFETY_LIMIT` (default 10,000), and `SCAN_TIME_BUDGET_MS` (default 60 minutes). Reaching a limit is logged, and not all application routes are necessarily discoverable by navigating links. Use route imports for gaps.
- **Schedule interval = 0** disables scheduled scans; the form explicitly accepts zero. Nonzero values are in minutes.
- **Different hosts and login URLs:** Allow each host in the site scope and each nondefault port explicitly. Extra host entries may be bare hosts or complete http(s) URLs; URL entries automatically include their port. URL paths are ignored by host scope parsing and must be configured as profile start/login URLs. Create separate authentication profiles with independent login URL, password, and optional **Authenticated start URL**. The start URL determines the root page crawled for that profile. For two separate applications with different origin/session rules, register them as separate websites (recommended) rather than relying on cross-domain cookies. Authentication does not silently expand host scope.
- **Unsafe/logout endpoints:** Scans refuse links and browser requests identified as unsafe actions. The dashboard sign-out button now asks for confirmation and only signs out the Website Auditor administrator.
- **Theme:** Frosted panels, restrained indigo/cyan accents, responsive gradient grid background, dark and light support, reduced-motion support. No remote design assets or library downloads.
- **Worker identity:** Leave `WORKER_ID=` blank to generate a unique per-process ID automatically. If setting it manually, each active process must use a different value; duplicate IDs defeat lease-ownership protections.
- If a scan remains queued: inspect worker health and events, then check `journalctl --user -u website-auditor-worker.service -f`. Test MongoDB and RustFS connectivity from the same host environment. The dashboard is not the worker.

## Live report explorer (no exports required)

Open `https://website-auditor.test/reports` and choose a website and completed scan. Use the HTTP-code, classification, and route/title search fields to query MongoDB in pages of 30 results. Click **Details** to use the existing authenticated evidence viewer, screenshot preview, investigation and retry actions. HTML, JSON and CSV exports remain optional; private RustFS credentials and objects are never exposed by the report list. Report history is only removed by an explicitly confirmed cleanup.

## Automatically supervised Playwright worker (host-native)

The host proxy works independently of Lerd framework detection. In this Lerd installation `lerd link` successfully starts Next.js but `lerd worker list` responds `site ... has no framework assigned`. An embedded host-worker `framework_def` is not a reliable workaround. **Do not keep relinking or assign `framework: laravel`.**

The project's `.lerd.yaml` follows the verified Taskloom host-proxy form without `framework`, `framework_def`, `custom_workers`, or `workers`. Install a separate, restartable user-level service instead:

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
npm install
npm run build
lerd link
fish scripts/install-worker.fish
systemctl --user --no-pager status website-auditor-worker.service
journalctl --user -u website-auditor-worker.service -f
```

This worker accesses `.test` sites using the host's normal DNS, does not open another listening port, and does not modify other Lerd sites. Do not launch `npm run worker` manually while the systemd unit runs. `WORKER_ID=` should normally remain empty. See [worker guide](docs/LERD_WORKER_AND_PERFORMANCE.md).

### Queue backend decision

MongoDB remains the durable job queue, so **neither Beanstalkd nor Valkey is required for auto-start**. Lerd can provision them as services, but choosing either as the queue backend requires adding and verifying a separate Node client and atomic reservation/acknowledgement implementation; merely adding `services: [beanstalkd]` or `services: [valkey]` does not migrate existing jobs. The current implementation intentionally avoids a second queue technology.

## Safe database cleanup and retention

Settings → **Database & evidence cleanup** has four separate cleanup modes: finished scans and RustFS evidence, verified-resolved issues, old scan events, and stale worker registrations. Choose a website or all auditor websites, and a minimum age in days. **Preview** retrieves eligible record counts without deleting anything. To actually delete, type `DELETE AUDITOR HISTORY`; the server verifies a signed five-minute authorization from the preview.

The cleanup is restricted to the configured `MONGO_DATABASE` and the per-scan prefix in the configured private RustFS bucket. Registered sites, authentication profiles, current open issues, and active scans are protected. Finished scans referenced by any issue record are deliberately excluded until the relevant issue history is handled. At most 50 old scans are deleted per execution; repeat the preview if more remain. RustFS objects are deleted first; if RustFS deletion fails, the MongoDB scan is retained. Bulk deletion cannot be undone: back up both MongoDB and RustFS before cleaning large histories.

**Diagnostic interpretation:** `net::ERR_BLOCKED_BY_CLIENT.Inspector` messages are treated as browser Inspector/tooling noise rather than automatically classifying an HTTP 200 page as failed. Intentionally blocked safe-crawl requests are listed in private network evidence; genuine page exceptions, unexpected HTTP 4xx/5xx and important asset/API failures remain actionable. Rerun affected routes after updating to reclassify old errors; historical records are preserved until explicitly cleaned.

## React/ESLint cleanups

The dashboard initial refresh and theme restoration are scheduled after mount; scan timer labels derive from the last successful dashboard refresh. The report explorer resets pagination in filter handlers, and stale responses are not displayed for newly selected filters. Login and logout use Next.js router navigation, and private evidence screenshots are rendered with unoptimized Next.js image components to avoid browser-accessible image optimizer leakage. No ESLint rules have been disabled.

## 2026-10-26: Host-native worker and performance upgrade

See [`docs/LERD_WORKER_AND_PERFORMANCE.md`](docs/LERD_WORKER_AND_PERFORMANCE.md). Lerd supervises the Next.js dashboard on port 3100; systemd supervises Chromium scans. Format code using `npm run format`, check using `npm run format:check`. New scans provide a Performance tab, screenshot zoom, and saved network details; old scans need a retry to obtain these measurements.

### HTTP 502 and Fish installer quick diagnosis

If Lerd reports that Next.js is `Ready` but `https://website-auditor.test`
returns 502, run `fish scripts/diagnose-502.fish`. This compares
`http://127.0.0.1:3100/login` against Lerd HTTPS and prints upstream-related
nginx configuration and log entries. Do not assume the worker service is
responsible for a reverse-proxy error.

The repaired `scripts/install-worker.fish` no longer uses nested backslash
quoting; validate with `fish -n scripts/install-worker.fish` and install with
`fish scripts/install-worker.fish`. It manages only
`website-auditor-worker.service`. See
[`docs/LERD_WORKER_AND_PERFORMANCE.md`](docs/LERD_WORKER_AND_PERFORMANCE.md).

## Authenticated scanning upgrade (October 26, 2026)

See [Authenticated Scans](docs/AUTHENTICATED_SCANS.md). Login profiles now establish and verify a Playwright session before crawling. The post-login landing or explicit private start URL seeds route discovery; protected navigation groups can be expanded safely. Scan/route/error records show their associated profile. Run `npm run test:auth:browser` to exercise the dedicated local authenticated fixture without involving a real application.
