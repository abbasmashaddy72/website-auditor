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
