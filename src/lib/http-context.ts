/** A challenge to an unauthenticated visitor is not evidence of a broken application.
 * A generic 403/404, authenticated challenge, or 5xx still requires investigation.
 */
export function expectedAuthenticationChallenge(
  status: number | undefined,
  authenticated: boolean,
  challengeHeader: string | null,
  visibleText: string,
): boolean {
  if (authenticated || (status !== 401 && status !== 403)) return false;
  const text = visibleText.slice(0, 2500);
  return (
    Boolean(challengeHeader?.trim()) ||
    /\b(?:authentication required|login required|please (?:log|sign) in|unauthenticated|sign in to continue)\b/i.test(
      text,
    )
  );
}
