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
