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
