# Lerd, worker supervision and browser performance

## Lerd proxy (port 3100)

`.lerd.yaml` should contain the host proxy but **no** `framework`, `framework_def`, `workers` or `custom_workers` entries. Lerd's `lerd worker` commands require an assigned framework; Lerd may not assign one to a host-proxy Next.js site even when `lerd link` succeeds. Its embedded framework definitions also strip trusted host-execution worker declarations. Do not repeatedly relink to repair this.

Run `fish scripts/install-worker.fish` **from the Website Auditor project root**. This writes only `~/.config/systemd/user/website-auditor-worker.service` and starts it. The app's `npm run prod` process is still managed by Lerd; the worker is automatically restarted by systemd without a terminal.

```fish
cd ~/Documents/Project-Sites/Experiment/website-auditor
npm install
npm run build
lerd link
fish scripts/install-worker.fish
systemctl --user --no-pager status website-auditor-worker.service
journalctl --user -u website-auditor-worker.service -f
```

Only **one** `npm run worker` instance/supervisor should be active. If another service controls it, stop that first. To stop: `systemctl --user disable --now website-auditor-worker.service`. The user-level unit runs while the user's login session is active; optionally ask the machine administrator to enable login lingering if it must continue after logoff. Do not run `lerd worker start auditor` for this host-proxy-only configuration.

## Fixing historical false-positive failures

`ERR_BLOCKED_BY_CLIENT.Inspector` on `https://fonts.bunny.net/...` is an intercepted external stylesheet. It should remain in recorded network evidence but be excluded from failure classification unless a meaningful rendering problem exists. Saved historical scans are immutable. Retry affected pages or start a new scan to verify results. A blocked critical JS/CSS asset without the Inspector suffix must still be assessed; do not blanket-ignore every `ERR_BLOCKED_BY_CLIENT` request.

## Timing instrumentation

New page visits record DNS, connect, TLS, TTFB and download phases where Chromium exposes them; DOMContentLoaded, load, FCP and LCP where available; total navigation/inspection time; and separate screenshot/storage overhead. Resources are ranked by duration, with search and type filters. Performance timings can be missing for cross-origin requests, redirects, cache hits, or old scans. Network requests overlap; do not sum all durations as a page-load total.

## Formatting parity with Taskloom

`prettier.config.mjs` mirrors Taskloom's 110-character line width, LF, 2-space indentation, single quotes, semicolons, Tailwind 4 class sorting. Website Auditor's Tailwind entry is `src/app/globals.css`. `eslint-config-prettier/flat` is placed after Next.js lint configurations. The intentionally Lerd-mutated `.lerd.yaml` and generated `package-lock.json` are excluded from the formatting command.

```fish
npm install
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## Diagnosing HTTP 502 (site builds but the browser fails)

A `✓ Ready` line from `lerd-app-website-auditor` proves only that Next.js started;
it does not prove nginx can reach the upstream. The project uses port 3100, so
start with these read-only checks:

```fish
fish scripts/diagnose-502.fish
curl -I http://127.0.0.1:3100/login
curl -k -I https://website-auditor.test/login
journalctl --user -u lerd-app-website-auditor -n 50 --no-pager
```

- If the **direct** URL fails: check `ss -ltnp 'sport = :3100'`,
  `npm run prod`, port ownership, and the app journal. Do not run a second
  development/production server while Lerd is already supervising one.
- If the **direct** URL succeeds but HTTPS gives **502**: inspect the generated
  nginx vhost `~/.local/share/lerd/nginx/conf.d/website-auditor.test.conf`
  and `podman logs --tail 80 lerd-nginx`. Compare `proxy_pass` with the
  _actual_ upstream and check for `connect() failed` or timeout errors.
- If both URLs work: look for intermittent restarts or route-specific errors;
  test `/login` before diagnosing protected routes or databases.

Do not change the listening address to `0.0.0.0`, re-link repeatedly, restart
other Lerd sites, or modify the generated nginx vhost until the upstream
failure has been identified. Lerd regenerates vhosts when linking.

## Fish installer repair

The old installer used Fish `string replace` with unbalanced backslash quoting.
The corrected script writes a single-quoted systemd unit template with `printf`
substitution and does not attempt to escape strings with nested Fish syntax.
It backs up an existing worker unit and verifies the new unit before enabling.

```fish
fish -n scripts/install-worker.fish
fish scripts/install-worker.fish
systemctl --user status website-auditor-worker.service
journalctl --user -u website-auditor-worker.service -f
```

The worker cannot repair an HTTP 502 from nginx: the worker handles scans,
while the Lerd `prod` process serves the dashboard. They have separate journals.
