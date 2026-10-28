# Website Auditor — Filament / Livewire authentication hotfix

## Changes

- Allow authorized login-phase POST requests to hashed Livewire 3 endpoints such as `/livewire-84119ac4/update`, to the configured login route, or to the discovered same-origin login form action.
- Continue rejecting arbitrary POST requests during normal crawling. Permit only Livewire component hydrations with no field changes and no actions (except the reserved `__lazyLoad` method). Such blocked requests become scan warnings rather than false 'passed' results.
- Detect login-form redirects from a configured URL such as `/cadmin` to `/cadmin/login`, using the actual rendered login URL when waiting for successful navigation.
- Include safe diagnostics for failed authentication, including blocked requests and generic target error banners, without logging credentials.
- Keep automatic crawl discovery in protected `/cadmin/...` and similar panel areas after login, rather than traversing public homepage links.
- Rename auditor website action **Login** to **Profiles** and add vertical scrolling and a constrained height to the profile modal.
- Raise sticky header stacking and show scan warning counts.
- Add a local regression fixture for a Livewire-style asynchronous login, plus pure request-policy tests.

## Installation

This patch applies over `Website_Auditor_Authenticated_Scans_Fixed_20261026.zip` (the authentication patch from the previous turn). It is not designed to apply directly over the older `Archive(3).zip` without first applying that release.

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
git apply --check ~/Downloads/Website_Auditor_Filament_Auth_UI_20261026.patch
git apply ~/Downloads/Website_Auditor_Filament_Auth_UI_20261026.patch
npm run format
npm run lint
npm run test
npm run typecheck
npm run build
npm run test:auth:browser
systemctl --user restart lerd-app-website-auditor.service
systemctl --user restart website-auditor-worker.service
```

For Insure360, configure **Profiles → Root** with login URL `https://insure360.test/cadmin/login` and authenticated start URL `https://insure360.test/cadmin`. Confirm authorized credentials. After updating, create a **new** scan; previously saved scans are immutable historical evidence. If login still fails, inspect `Live scan activity` for the new network/authentication diagnosis, and verify the target in a normal browser. A target-side Livewire/CSRF/session error requires target-side investigation; the auditor will not bypass authentication.

The protected-route heuristic uses the first path segment for nested or known panel roots. A website whose internal navigation legitimately crosses unrelated origins or separate path roots should be registered as separate approved targets or extended with explicit discovery scopes before scanning.

## Verification limits

The source, syntax and pure policy tests were checked in the packaging environment. Full project ESLint/typecheck/build and real browser login against Lerd/Insure360 must run in your local installation. In particular, no credentials, database records or targets were modified here.
