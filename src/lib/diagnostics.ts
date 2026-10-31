/** Browser automation itself and installed devtools can generate synthetic network failures. */
export function isInspectorNoise(text: string): boolean {
  return (
    /ERR_BLOCKED_BY_CLIENT\.Inspector\b/i.test(text) ||
    /\bInspector\b[^\n]{0,160}\bERR_BLOCKED_BY_CLIENT\b/i.test(text)
  );
}

/** Deliberate safe-crawl network blocks are not evidence of a target-site defect. */
export function isPolicyBlockedRequest(failure?: string): boolean {
  return /\bERR_BLOCKED_BY_CLIENT\b/i.test(failure || '');
}

export function classifyBrowserDiagnostics(
  consoleErrors: string[],
  requests: Array<{ url: string; method: string; status?: number; failure?: string }>,
  explicitlyPolicyBlocked: ReadonlySet<string> = new Set(),
) {
  const ignoredConsole = consoleErrors.filter(isInspectorNoise);
  const actionableConsole = consoleErrors.filter((message) => !isInspectorNoise(message));
  const policyBlocked = requests.filter(
    (r) => explicitlyPolicyBlocked.has(r.url) || isInspectorNoise(r.failure || ''),
  );
  const actionableRequests = requests.filter(
    (r) => !explicitlyPolicyBlocked.has(r.url) && !isInspectorNoise(r.failure || ''),
  );
  return { ignoredConsole, actionableConsole, policyBlocked, actionableRequests };
}

/** Network failures to functional assets/APIs are fatal; ordinary failed image/font requests are warnings. */
export function isCriticalSubrequest(request: { url: string; status?: number; failure?: string }): boolean {
  return (
    [401, 403, 419, 422].includes(request.status || 0) ||
    (request.status || 0) >= 500 ||
    /\.(?:js|css)(?:\?|$)/i.test(request.url) ||
    /livewire|_next|api\//i.test(request.url)
  );
}

/** Previously these signals triggered evidence capture but produced no warning record. */
export function nonFatalBrowserWarnings(
  consoleMessages: readonly string[],
  requests: readonly { url: string; status?: number; failure?: string }[],
): string[] {
  const warnings = new Set<string>();
  for (const message of consoleMessages.slice(0, 15)) {
    if (message.trim() && !/hydration|uncaught|exception|error|failed|HTTP [45]\d\d/i.test(message))
      warnings.add(`Console diagnostic: ${message.slice(0, 400)}`);
  }
  for (const request of requests.slice(0, 20)) {
    if (isCriticalSubrequest(request) || /\bERR_ABORTED\b/i.test(request.failure || '')) continue;
    const detail = request.status
      ? `status ${request.status}`
      : (request.failure || 'request failed').slice(0, 100);
    warnings.add(`Noncritical subrequest ${detail}: ${request.url.slice(0, 380)}`);
  }
  return [...warnings];
}

/** Chromium's generic resource message has no route/type; use captured request evidence
 * for its severity instead of treating every missing image/font as a JavaScript failure.
 */
export function isCorrelatedResourceConsole(
  message: string,
  requests: readonly { url: string; status?: number; failure?: string }[],
): boolean {
  if (!/^Failed to load resource:/i.test(message.trim())) return false;
  const code = /status of ([45]\d\d)\b/i.exec(message)?.[1];
  return requests.some(
    (request) =>
      !isCriticalSubrequest(request) &&
      !/\bERR_ABORTED\b/i.test(request.failure || '') &&
      (code === undefined || request.status === Number(code)),
  );
}
