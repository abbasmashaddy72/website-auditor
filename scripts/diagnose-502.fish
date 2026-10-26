#!/usr/bin/env fish
# Read-only Lerd / Next.js upstream diagnostics for Website Auditor.
# No changes to Lerd, nginx, ports, processes, database, or other sites.

set -l domain website-auditor.test
set -l port 3100
set -l vhost "$HOME/.local/share/lerd/nginx/conf.d/$domain.conf"

echo '== Website Auditor / Lerd 502 diagnostics =='
echo "Site: https://$domain  |  Expected upstream: http://127.0.0.1:$port"
echo

echo '[1] Next.js direct HTTP response'
curl --noproxy '*' --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}  connect=%{time_connect}s  total=%{time_total}s\n' --max-time 10 "http://127.0.0.1:$port/login"
echo

echo '[2] HTTPS through Lerd nginx (ignoring local CA errors only for diagnostics)'
curl --noproxy '*' --insecure --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}  connect=%{time_connect}s  total=%{time_total}s\n' --max-time 10 "https://$domain/login"
echo

echo '[3] Port ownership'
ss -ltnp "sport = :$port"
echo

echo '[4] Lerd-generated nginx vhost upstream and server names'
if test -f "$vhost"
    echo "File: $vhost"
    grep -nE 'proxy_pass|upstream|server_name|listen|proxy_set_header' "$vhost"
else
    echo "No vhost at expected path: $vhost"
    echo 'Check the active Lerd nginx configuration path before attempting a relink.'
end
echo

echo '[5] App process supervisor'
systemctl --user --no-pager --full status lerd-app-website-auditor.service

echo

echo '[6] Recent Lerd nginx errors (may include other site names)'
if command -sq podman
    podman logs --since 5m --tail 75 lerd-nginx 2>&1 | grep -Ei '502|upstream|connect\(\)|refused|timed out|website-auditor|error' | tail -35
end

echo

echo 'Interpretation:'
echo '  Direct HTTP fails: inspect the Node process, port ownership and app journal.'
echo '  Direct HTTP works but HTTPS gives 502: inspect proxy_pass/upstream and nginx logs.'
echo '  Both work: investigate intermittent reload/race, browser cache or route-specific failures.'
echo '  Before sharing logs, remove credentials, tokens, cookies and other private URLs.'
