# Website Auditor — Authenticated scan operations

The target application remains independent. The auditor does not add code, routes, or credentials to Insure360 or any other website.

## Configure distinct profiles

1. Open **Websites → Login** for the registered site and create a named profile (for example, `Central Admin` or `Broker Tenant`). Each profile is associated with one registered website.
2. Enter the complete **Login URL** (e.g. `https://insure360.test/cadmin/login`) and authorized test credentials. All login and start hosts and ports must be included in the website's approved scope.
3. Prefer an explicit **Authenticated start URL** (e.g. `https://insure360.test/cadmin`) for Filament/tenant portals. A public root URL is **not** a substitute for a private dashboard. Different cookie domains require separate sessions/profiles.
4. If the login navigates to a private dashboard, you may leave the start URL blank; the auditor uses the **post-login landing page** rather than public `/`.
5. Optional custom selectors are supported for username, password, submit button, a success element, or a success URL. Use an explicit success selector for same-URL SPA logins.
6. Existing profiles can be edited from the Login dialog. Leave Password blank when editing to preserve the encrypted value.
7. Open **Scans** and explicitly select the target website and profile. When there is exactly one profile, it is preselected on website selection; `Unauthenticated` is still available explicitly.

## What happens during a scan

- The worker attempts authentication **before** crawling and stops with a failed scan if it cannot confirm login; it does not silently use a public crawl as a substitute.
- The worker checks the authenticated start URL before beginning discovery, catches redirects back to login and records authentication errors. A session refresh is attempted once after an authenticated page redirects to login.
- The worker follows safe `a[href]` links and opens navigation groups marked with `aria-expanded="false"` within navigation/sidebar containers. This is deliberately conservative: some SPAs require application-specific interaction rules or imported routes. Destructive forms and logout links are not clicked.
- The scanner restores Playwright cookies/local storage per visited page. Some authentication schemes depend on `sessionStorage`, WebAuthn, MFA, CAPTCHA, SSO cross-domain callbacks or rotating non-cookie tokens; those may require a profile-specific extension or manual authentication. No bypass is attempted.
- Scan list, Routes, Errors, Page Diagnostics, HTML/CSV/JSON report metadata identify the selected profile. Historical scans remain intact.

## Verifying login without involving Insure360

```fish
npm run test
npm run test:auth:browser
```

The browser integration command launches a _local_ fixture service and Chromium, logs in with fixture-only credentials, discovers links hidden behind a collapsible navigation group, and opens a second private page with the restored session. It requires Playwright's Chromium executable to be installed (`npx playwright install chromium`), but does not need MongoDB or RustFS. The fixture binds to `127.0.0.1:8887`.

This fixture does not certify login against a particular application or environment. To verify a real tenant or central panel, configure that profile and inspect the `authentication`/`authenticated` scan events and the displayed authenticated start URL.

## Troubleshooting

- **No private routes:** Confirm that the selected scan shows a named auth profile, not `Unauthenticated`. Verify that the login redirects to a private landing page, or configure an explicit start URL. Try `--max-pages` and depth limits that cover the navigation, and import safe parameterized routes with concrete IDs if needed.
- **Login fails:** Check URL, username/password fields, profile selectors, allowed host/port scope, local certificate trust and app-specific MFA requirements. Failures are visible in the scan row and worker events.
- **Two profiles show the same pages:** Profiles may have the same permissions, the login may land on a public page, or the target may not share a session across subdomains. Set different verified private start URLs and test each account's accessible navigation separately.
- **UI access still appears public:** Cross-subdomain cookies must be issued by the target application for the intended domain. Auditor cannot force host-only cookies to work on a different host.
