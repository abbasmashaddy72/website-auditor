#!/usr/bin/env fish
systemctl --user --no-pager status website-auditor-worker.service
journalctl --user --no-pager -u website-auditor-worker.service -n 35
