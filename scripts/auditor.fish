#!/usr/bin/env fish
# Website Auditor — project-scoped worker and proxy manager.
# Usage: fish scripts/auditor.fish [setup|install|start|enable|restart|stop|disable|status|logs|doctor|uninstall|help]
set -l action setup
if set -q argv[1]
    set action $argv[1]
end
set -l root (pwd -P)
if not test -f "$root/package.json"; or not test -f "$root/worker/index.ts"
    echo 'Run from the Website Auditor project root.' >&2
    exit 1
end
set -l service website-auditor-worker.service
set -l unit_dir "$HOME/.config/systemd/user"
set -l unit "$unit_dir/$service"

switch "$action"
case help -h --help
    echo 'Usage: fish scripts/auditor.fish [command]'
    echo '  setup     Install, verify, enable, start and display worker plus proxy diagnostics (default)'
    echo '  install   Generate and validate the systemd unit, enable and start it'
    echo '  start     Start worker'
    echo '  enable    Enable worker for automatic startup, and start now'
    echo '  restart   Restart worker'
    echo '  stop      Stop worker (queued scans remain persistent)'
    echo '  disable   Stop worker and disable autostart'
    echo '  status    Worker and Lerd app service status'
    echo '  logs      Follow worker journal (Ctrl+C to exit)'
    echo '  doctor    Inspect bindings, direct HTTP, HTTPS proxy, recent logs'
    echo '  uninstall Stop, disable and remove only Website Auditor worker unit'
    exit 0
case setup install
    if not test -f "$root/node_modules/tsx/dist/cli.mjs"
        echo 'Missing node_modules/tsx: run npm install before installing the worker.' >&2
        exit 1
    end
    set -l node (command -s node)
    if test -z "$node"
        echo 'Node.js not found in PATH.' >&2
        exit 1
    end
    for path in "$root" "$node"
        if string match -q '*"*' -- "$path"; or string match -q '*\n*' -- "$path"
            echo 'Path contains unsupported quoting or newline.' >&2
            exit 1
        end
    end
    mkdir -p "$unit_dir"; or exit 1
    if test -f "$unit"
        cp "$unit" "$unit.bak."(date +%Y%m%d%H%M%S); or exit 1
    end
    set -l node_dir (dirname "$node")
    # WorkingDirectory MUST NOT have literal double quotes; spaces are valid.
    # ExecStart supports quoted executable/argument paths.
    printf '[Unit]\nDescription=Website Auditor Playwright Worker\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=%s\nEnvironment="PATH=%s:/usr/local/bin:/usr/bin:/bin"\nExecStart="%s" "%s/node_modules/tsx/dist/cli.mjs" worker/index.ts\nRestart=always\nRestartSec=5\nTimeoutStopSec=30\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n' "$root" "$node_dir" "$node" "$root" > "$unit"; or exit 1
    if command -sq systemd-analyze
        systemd-analyze --user verify "$unit"; or exit 1
    end
    systemctl --user daemon-reload; or exit 1
    systemctl --user enable --now "$service"; or exit 1
    systemctl --user --no-pager status "$service"
    if test "$action" = setup
        echo '\n== Lerd proxy diagnostics =='
        fish (status filename) doctor
    end
case start
    systemctl --user start "$service"
case enable
    systemctl --user enable --now "$service"
case restart
    systemctl --user restart "$service"
case stop
    systemctl --user stop "$service"
case disable
    systemctl --user disable --now "$service"
case status
    systemctl --user --no-pager status "$service"
    systemctl --user --no-pager status lerd-app-website-auditor.service
case logs
    journalctl --user -u "$service" -f
case doctor
    echo '== Listener 3100 =='
    ss -ltnp '( sport = :3100 )'
    echo '\n== Direct Next.js =='
    curl --connect-timeout 3 --max-time 10 -sS -o /dev/null -w 'HTTP %{http_code} connect=%{time_connect}s total=%{time_total}s\n' http://127.0.0.1:3100/login
    echo '\n== Lerd HTTPS =='
    curl -k --connect-timeout 3 --max-time 10 -sS -o /dev/null -w 'HTTP %{http_code} connect=%{time_connect}s total=%{time_total}s\n' https://website-auditor.test/login
    echo '\n== Configured nginx proxy_pass =='
    set -l vhost "$HOME/.local/share/lerd/nginx/conf.d/website-auditor.test.conf"
    if test -f "$vhost"
        grep -n 'proxy_pass\|server_name' "$vhost"
    else
        echo "No vhost file at $vhost"
    end
    echo '\n== Worker health =='
    systemctl --user --no-pager --full status "$service"
    echo '\n== Recent worker journal =='
    journalctl --user -u "$service" -n 25 --no-pager
    echo '\n== Recent Lerd app journal =='
    journalctl --user -u lerd-app-website-auditor.service -n 20 --no-pager
case uninstall
    systemctl --user disable --now "$service"
    if test -f "$unit"
        cp "$unit" "$unit.bak."(date +%Y%m%d%H%M%S); or exit 1
        rm "$unit"; or exit 1
    end
    systemctl --user daemon-reload
    echo 'Worker unit removed. MongoDB scans and RustFS evidence unchanged.'
case '*'
    echo "Unknown command: $action" >&2
    fish (status filename) help
    exit 2
end
