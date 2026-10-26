/** Pure authentication decisions shared by scanner and tests. */
export function chooseAuthenticatedSeed(
  startUrl: string | undefined,
  landingUrl: string,
  baseUrl: string,
): string {
  // Once login succeeded, never silently fall back to the public home page.
  if (startUrl?.trim()) return startUrl;
  if (!landingUrl?.trim()) throw Error('Authenticated landing URL missing; configure a start URL');
  const target = new URL(landingUrl);
  const base = new URL(baseUrl);
  if (!['https:', 'http:'].includes(target.protocol)) throw Error('Invalid authenticated landing URL');
  if (target.username || target.password) throw Error('Authenticated landing URL contains credentials');
  if (/\/(?:login|sign-in|signin)(?:\/|$)/i.test(target.pathname))
    throw Error('Authenticated landing URL is still a login page; configure a start URL');
  if (target.origin === base.origin && target.pathname === base.pathname)
    throw Error('Login redirected to the public website root; configure an explicit authenticated start URL');
  return target.toString();
}

export function looksLikeUnauthenticatedPage(
  finalUrl: string,
  loginUrl: string,
  passwordVisible: boolean,
  requestedUrl: string,
): boolean {
  const final = new URL(finalUrl);
  const login = new URL(loginUrl);
  const requested = new URL(requestedUrl);
  const matchesLogin = final.origin === login.origin && final.pathname === login.pathname;
  const unexpectedLogin =
    matchesLogin && (requested.origin !== login.origin || requested.pathname !== login.pathname);
  const loginLikePath = /\/(?:login|sign-in|signin)(?:\/|$)/i.test(final.pathname);
  return unexpectedLogin || (passwordVisible && (matchesLogin || loginLikePath));
}

/**
 * Authenticated crawling favors the protected application rather than falling back
 * into its public landing page or discovering password-reset/login routes.
 * A first path segment is treated as an application boundary only for explicit
 * admin-like roots or when the landing URL is nested under that segment.
 */
export function isAuthenticatedDiscoveryCandidate(
  rawUrl: string,
  seedUrl: string,
  loginUrl: string,
  publicBaseUrl: string,
): boolean {
  const candidate = new URL(rawUrl);
  const seed = new URL(seedUrl);
  const login = new URL(loginUrl);
  const publicBase = new URL(publicBaseUrl);
  if (candidate.origin !== seed.origin) return false;
  if (candidate.pathname === login.pathname && candidate.origin === login.origin) return false;
  if (/\/(?:login|sign-in|signin|password-reset|forgot-password)(?:\/|$)/i.test(candidate.pathname))
    return false;
  if (
    candidate.origin === publicBase.origin &&
    candidate.pathname === publicBase.pathname &&
    (seed.origin !== publicBase.origin || seed.pathname !== publicBase.pathname)
  )
    return false;
  const parts = seed.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const appRoot = parts[0];
  const isApplicationBoundary =
    parts.length > 1 || /^(?:admin|cadmin|panel|portal|private|workspace|insure360)$/i.test(appRoot);
  if (!isApplicationBoundary) return true;
  const prefix = `/${appRoot}`;
  return candidate.pathname === prefix || candidate.pathname.startsWith(`${prefix}/`);
}
