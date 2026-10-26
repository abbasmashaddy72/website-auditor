# Website Auditor — One-command Fish worker manager

In the project root, run `fish scripts/auditor.fish setup` to install, verify, enable and start the dedicated systemd user worker, and run connectivity checks.

Other commands: `status`, `logs`, `start`, `stop`, `restart`, `enable`, `disable`, `doctor`, `uninstall`, `help`. Use `fish scripts/auditor.fish <command>`. The worker manager only changes `~/.config/systemd/user/website-auditor-worker.service`. Its `doctor` action is read-only.

The port fix changes `npm run prod` and `npm start` to bind to `0.0.0.0:3100` so the host-side Lerd proxy at `169.254.1.2:3100` can connect. Restart only the website-auditor Lerd app service after applying: `systemctl --user restart lerd-app-website-auditor.service`. Do not expose TCP 3100 to untrusted networks; use host firewall.

Unlike a web server, the scanner worker needs no incoming listener/port. No Beanstalkd/Valkey is required.

If the worker is needed even after logout (without an active login session), investigate `loginctl enable-linger` for the user; do not enable system-wide behavior without deciding this is appropriate.

Note: `npm run build` and the Fish script cannot be fully tested in this execution environment without dependencies and the Fish executable. Verify on CachyOS.
