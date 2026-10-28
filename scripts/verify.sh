#!/usr/bin/env bash
# Unified, fail-fast Website Auditor quality gate. No service restarts or database mutations.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPORT_ROOT="${AUDITOR_VERIFICATION_DIR:-storage/test-reports/verification}"
mkdir -p "$REPORT_ROOT"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
REPORT="$REPORT_ROOT/$STAMP"
mkdir -p "$REPORT"
STATUS=Passed
stage() {
  local name="$1"; shift
  printf '\n==> %s\n' "$name" | tee -a "$REPORT/summary.txt"
  if "$@" >"$REPORT/$name.log" 2>&1; then
    printf 'PASS %s\n' "$name" | tee -a "$REPORT/summary.txt"
  else
    local rc=$?
    printf 'FAIL %s (exit %s)\n' "$name" "$rc" | tee -a "$REPORT/summary.txt"
    tail -n 35 "$REPORT/$name.log"
    STATUS=Failed
    return "$rc"
  fi
}
finish() {
  local code=$?
  if (( code != 0 )); then STATUS=Failed; fi
  printf 'status=%s\ncompleted_utc=%s\nreport_dir=%s\n' "$STATUS" "$(date -u +%FT%TZ)" "$REPORT" > "$REPORT/result.txt"
  echo "Verification: $STATUS; report: $REPORT"
}
trap finish EXIT
case "${1:-}" in
  --help|-h) echo 'Usage: bash scripts/verify.sh [--format] (format optional; always lint/test/typecheck/build)'; exit 0;;
  --format) stage format npm run format;;
  '') :;;
  *) echo "Unknown option: $1" >&2; exit 2;;
esac
stage updater-safety python3 scripts/test-update.py
stage deployment-safety python3 scripts/test-deployment.py
stage lint npm run lint
stage test npm run test
stage typecheck npm run typecheck
stage build npm run build
