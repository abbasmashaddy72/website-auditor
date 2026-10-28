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
