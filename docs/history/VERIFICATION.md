# Verification Report and Local Acceptance Checklist

Generated on 2026-10-25. Status labels distinguish actual validation from implementation-only or local checks still required.

| Check                                                      | Status in generation environment                                                       | Required local acceptance evidence                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.lerd.yaml` form verified against published documentation | Reference verified                                                                     | `lerd --version`, compare with local Taskloom, successful `lerd link` and `lerd secure` |
| Independent project source exists                          | Verified by bundle file creation                                                       | Unzip in target folder, no changes to Insure360                                         |
| TypeScript/TSX files parse without syntax errors           | Static parsing completed                                                               | `npm run typecheck`, `npm run build`                                                    |
| Unit tests                                                 | **8 isolated tests passed** using TypeScript transpilation and native Node test runner | `npm run test` with installed dependencies                                              |
| npm install and production build                           | Not run (npm registry unreachable in sandbox)                                          | `npm install`, `npm run build`                                                          |
| Lerd HTTPS host proxy                                      | Not run (Lerd absent)                                                                  | `curl -I https://website-auditor.test`                                                  |
| MongoDB connection, indexes and leases                     | Not run (service absent)                                                               | `npm run doctor`, enqueue scan, stop/restart worker                                     |
| RustFS upload/download & private bucket                    | Not run (service absent)                                                               | `npm run doctor`, inspect captured evidence                                             |
| Host-local `.test` DNS & TLS                               | Not run (site absent)                                                                  | `getent hosts insure360.test`, HTTPS site verified with trusted CA                      |
| Loopback and public HTTPS crawl                            | Not run                                                                                | fixture scan + public authorized site                                                   |
| HTTP 200/403/404/500 fixtures                              | **HTTP fixture responses verified (5/5)** using native Node fetch; Playwright not run  | `npm run fixture` and worker scan using 127.0.0.1:8877                                  |
| JavaScript runtime errors                                  | Implemented, not browser-tested                                                        | visit fixture `/runtime` and inspect page failures                                      |
| Authentication profiles                                    | Implemented, not end-to-end tested                                                     | test a disposable authorized site with login + expiry                                   |
| Redacted original/rendered HTML, screenshot, trace         | Code implemented, not integration-tested                                               | check RustFS objects and protected viewer                                               |
| Worker recovery, pause and cancellation                    | Code implemented, not failure-injection tested                                         | kill/restart worker, inspect leases and exact page counts                               |
| Issue verification after retry                             | Code implemented, not browser-tested                                                   | induce 500, fix fixture, retry, assert HTTP 200 and issue history                       |
| HTML/JSON/CSV outputs                                      | Code implemented, not integration-tested                                               | download and inspect all exports                                                        |
| Responsive UI/light-dark                                   | Components implemented, not visually reviewed in browser                               | test desktop/mobile with dark/light modes                                               |
| Live managed authentication                                | CLI code implemented, not interactive-tested                                           | run headed browser from host graphical session                                          |
| Source investigation and approved patch                    | Code implemented, not integration-tested                                               | disposable Git repo test, `git apply --check`, backup, explicit approval                |

## Isolated fixture acceptance procedure

Start the browser worker and the local fixture server from different terminals:

```fish
npm run fixture
npm run worker
```

In a third terminal, register the **disposable fixture only**:

```fish
npm run scan -- --site http://127.0.0.1:8877 --authorize --allow-local --depth 2 --max-pages 20
npm run scan:status
```

Expected after worker completes: `/ok` passes, `/forbidden` yields main HTTP 403, `/missing` yields 404, `/broken` yields 500 and `/runtime` yields HTTP 200 with a JavaScript runtime failure. Check the dashboard's routes and errors, screenshots, redacted HTML, and HTML/JSON/CSV report downloads. Use the saved scan ID to retry failed pages and verify historical records remain unchanged.

### Live-target acceptance

```fish
getent hosts insure360.test
curl -I https://insure360.test
npm run doctor -- --site https://insure360.test --allow-local
npm run scan -- --site https://insure360.test --authorize --allow-local
npm run scan:status
```

The worker should not require modifying the target. Record each actual result with command, exit code, HTTP response, screenshot, relevant exception and timestamp before setting a check to **passed**. Do not assume a target's return code is 200 without live verification.

### Worker recovery acceptance

Queue a fixture scan, then terminate the worker during active processing; restart it after the lease expires (`WORKER_LEASE_SECONDS`) and confirm no scan remains permanently stuck in `running`. Verify the page and issue histories, queue progress, and return status; check Chromium processes are cleaned up.

### Security acceptance

Use a disposable test site to verify that unapproved hosts/ports, metadata endpoints, redirect escapes, and non-GET requests are denied, production TLS errors are not ignored, and snapshots don't contain configured secrets. Exercise source patch approval against a disposable Git repository under `LOCAL_SOURCE_ROOT`, and test backup restoration.

## October 2026 queue/UI update — additional checks required

Static TypeScript/TSX parsing was performed in the build environment, including the new queue lifecycle and dashboard. Dependencies are not cached here, so a complete `tsc --noEmit` or production Next.js build has NOT been executed.

On the user's CachyOS machine, verify:

1. `npm run typecheck && npm run lint && npm run build && npm run test`.
2. In an existing worker-free state, queue a scan. Confirm it shows Queued, a worker-offline warning, and can be cancelled immediately without running it.
3. With a healthy worker, start an authorized fixture scan, watch new page events and progress, and verify 200/403/404/500/JS diagnostics.
4. Click Start twice with identical settings: both should return the same scan ID while the first is queued/running. Different authentication profiles and retry URLs must not collide.
5. Confirm `scheduleMinutes=0` saves and reloads; `maxPages=0` means Auto, bounded by `AUTO_PAGE_SAFETY_LIMIT`, time and crawl-depth constraints.
6. Create two auth profiles with distinct allowed login and start URLs. Confirm out-of-scope login origins are rejected.
7. Pause/resume/cancel a running test scan, recover after killing the worker, and inspect the activity feed.
8. Confirm Taskloom remains bound to 3000, Website Auditor to 3100, and Lerd TLS/proxy settings are unaffected.
9. Confirm dashboard logout asks for confirmation; ensure scanned unsafe/logout endpoints are not requested.
10. Manually test light/dark styles, high zoom/mobile viewport, and screen-reader labels.

These integration scenarios are **NOT claimed as passed**.

## Queue / reporting / cleanup upgrade acceptance checklist

- [ ] `systemctl --user status website-auditor-worker.service` reports active; journal contains scanner initialization and progress events; site host proxy remains healthy.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build` finish successfully on the actual Node 22 CachyOS installation.
- [ ] Lerd HTTPS routes `website-auditor.test` to port 3100 without interfering with Taskloom.
- [ ] Test a 200 page with `ERR_BLOCKED_BY_CLIENT.Inspector`: it does **not** create a blocking issue solely for the Inspector message. Check retained diagnostic evidence.
- [ ] Inject a true JavaScript exception and HTTP 500 fixture: it **does** produce blocking issues.
- [ ] Retry old false-positive pages: new verification records show `passed` only if the new visit has no actionable errors.
- [ ] Open Reports, filter by website, scan, HTTP status, classification, and URL; pagination and page Details use the protected APIs without downloading CSV/HTML.
- [ ] In Settings, Preview cleanup returns counts and refuses execution until the exact confirmation phrase is supplied.
- [ ] The cleanup endpoint rejects tampered or expired tokens; active scans and website/auth profiles are not deleted.
- [ ] Create a completed old scan with RustFS evidence and no referencing issues, preview and delete, then confirm both Mongo page/scan records and RustFS objects are removed.
- [ ] Force RustFS deletion to fail; verify the related Mongo scan remains present for retry.
- [ ] Refresh the dashboard and restart the dedicated systemd worker; queued work resumes without requiring a foreground `npm run worker` process.

**Environment status:** This package was statically parsed in the packaging container. It could not be integrated with the user's live Lerd/MongoDB/RustFS/Chromium environment, so none of the above acceptance checks is claimed to have passed here.

## ESLint and worker registration follow-up

The 2026-10-26 lint/worker patch addresses the 7 ESLint errors and 13 warnings reported after the previous package. In the build environment used to prepare this patch, 34 TypeScript/TSX files passed syntax parsing and the Lerd YAML passed structural parsing; there was no installed project `node_modules`, so lint, typecheck, production build, Lerd worker registry, and browser scanning must be rerun on the developer's machine.

Run: `npm run format:check; npm run lint; npm run test; npm run typecheck; npm run build; lerd link; fish scripts/install-worker.fish`. Check `journalctl --user -u website-auditor-worker.service -f`. Verify page timing on a new scan, the screenshot viewer, and Inspector-only 200 responses. One scanner supervisor must be active.

## 2026-10-26: Page performance and formatting acceptance

- [ ] Run `npm install`, `npm run format`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`. Formatter dependencies are not available in the packaging sandbox.
- [ ] Verify `.lerd.yaml` remains untouched by Prettier and host proxy still serves port 3100.
- [ ] New scan includes per-resource timings (slowest first), DOM ready / load / FCP / LCP where available, and separate evidence-upload overhead.
- [ ] Screenshot supports zoom and fullscreen inside the Page Diagnostics drawer; HTML original and rendered sources remain isolated.
- [ ] `network.json` with `ERR_BLOCKED_BY_CLIENT.Inspector` for Bunny Fonts alone does not classify an HTTP 200 document as failed on a new scan. Historical scan results must not be rewritten.
- [ ] Systemd unit stays active when the browser dashboard closes and restarts after a worker crash.
