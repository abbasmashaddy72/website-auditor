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
