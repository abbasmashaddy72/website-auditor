import { chromium, type Browser, type BrowserContext, type Request, type Response } from 'playwright';
import { ObjectId } from 'mongodb';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../src/lib/db';
import { assertTargetAllowed, canonicalLink, isCrawlablePageUrl, isSafeLink } from '../src/lib/scope';
import { putEvidence } from '../src/lib/storage';
import { redactHtml, redactText, redactUrl } from '../src/lib/redact';
import { resourceFromPlaywright, type ResourceTiming, type PageTiming } from '../src/lib/performance';
import { recordPageIssues } from '../src/lib/issues';
import { updateProgress } from '../src/lib/queue';
import { recordScanEvent } from '../src/lib/telemetry';
import { decrypt } from '../src/lib/crypto';
import { classifyBrowserDiagnostics } from '../src/lib/diagnostics';
import { gradePageWithPolicy, normalizeBrowserError } from '../src/lib/scan-grade';
import {
  chooseAuthenticatedSeed,
  isAuthenticatedDiscoveryCandidate,
  looksLikeUnauthenticatedPage,
} from '../src/lib/auth-discovery';
import {
  isApprovedLoginMutation,
  isReadOnlyLivewireHydration,
  isPassiveLivewireUpdate,
  isBrowserFaithfulLivewireRequest,
} from '../src/lib/request-policy';
import type { AuthProfile, PageResult, Scan, Site } from '../src/lib/types';

export async function configureContext(
  context: BrowserContext,
  site: Site,
  authPhase = false,
  loginUrl?: string,
  policyBlocked?: Set<string>,
  approvedLoginActions: ReadonlySet<string> = new Set(),
  allowedPassiveLivewire?: Set<string>,
  allowedBrowserLivewire?: Set<string>,
  scannedPageUrl?: string,
  blockReasons?: Map<string, string>,
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (!/^https?:\/\//i.test(url)) {
      await route.continue();
      return;
    }
    try {
      await assertTargetAllowed(url, site);
      if (!isSafeLink(url)) throw Error('Unsafe navigation or request blocked');
      const method = request.method().toUpperCase();
      // A request can occur before Playwright has associated a navigated URL
      // with its frame. Fall back to the exact approved page under test, never
      // to a global hostname or to a different website's authentication state.
      let requestPageUrl = scannedPageUrl || site.baseUrl;
      try {
        const frameUrl = request.frame().url();
        if (/^https?:\/\//i.test(frameUrl)) requestPageUrl = frameUrl;
      } catch {
        // Frame unavailable for early requests or service-worker activity.
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        if (authPhase) {
          if (method !== 'POST' || !loginUrl || !isApprovedLoginMutation(url, loginUrl, approvedLoginActions))
            throw Error(`Unapproved authentication mutation: ${method} ${new URL(url).pathname}`);
        } else if (
          site.environment !== 'production' &&
          site.allowLivewireBackground &&
          isBrowserFaithfulLivewireRequest(
            url,
            requestPageUrl,
            method,
            request.postData(),
            request.isNavigationRequest(),
            request.resourceType(),
          )
        ) {
          // Explicitly authorized browser-faithful page traffic; NOT guaranteed read-only.
          allowedBrowserLivewire?.add(url);
        } else if (isReadOnlyLivewireHydration(url, method, request.postData())) {
          // Known framework hydration methods are always allowed.
        } else if (
          site.environment !== 'production' &&
          site.allowPassiveLivewire &&
          !request.isNavigationRequest() &&
          isPassiveLivewireUpdate(url, requestPageUrl, method, request.postData())
        ) {
          // Only page-originated background requests. No scanner form/action clicks.
          allowedPassiveLivewire?.add(url);
        } else {
          throw Error(`Unapproved background mutation: ${method} ${new URL(url).pathname}`);
        }
      }
      await route.continue();
    } catch (reason) {
      policyBlocked?.add(url);
      blockReasons?.set(
        url,
        reason instanceof Error ? reason.message : 'Denied by target scope or crawl policy',
      );
      await route.abort('blockedbyclient').catch(() => {});
    }
  });
}
/** Authenticated session is established before any route discovery starts. */
export async function loginAndSession(
  browser: Browser,
  site: Site,
  profile: AuthProfile,
): Promise<{
  storageState: Awaited<ReturnType<BrowserContext['storageState']>>;
  landingUrl: string;
}> {
  await assertTargetAllowed(profile.loginUrl, site);
  if (profile.startUrl) await assertTargetAllowed(profile.startUrl, site);
  const context = await browser.newContext({ ignoreHTTPSErrors: site.ignoreHTTPSErrors });
  const approvedLoginActions = new Set<string>();
  const policyBlocked = new Set<string>();
  await configureContext(context, site, true, profile.loginUrl, policyBlocked, approvedLoginActions);
  const page = await context.newPage();
  const loginFailures: string[] = [];
  page.on('requestfailed', (request) => {
    if (isApprovedLoginMutation(request.url(), profile.loginUrl, approvedLoginActions))
      loginFailures.push(
        `${new URL(request.url()).pathname}: ${request.failure()?.errorText || 'request failed'}`,
      );
  });
  page.on('response', (response) => {
    if (
      response.request().method() !== 'GET' &&
      response.status() >= 400 &&
      isApprovedLoginMutation(response.url(), profile.loginUrl, approvedLoginActions)
    )
      loginFailures.push(`${new URL(response.url()).pathname}: HTTP ${response.status()}`);
  });
  try {
    const loginResponse = await page.goto(profile.loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: site.timeoutMs,
    });
    if (loginResponse && loginResponse.status() >= 400)
      throw Error(`Login page returned HTTP ${loginResponse.status()}`);
    const effectiveLoginUrl = page.url();
    const user =
      profile.usernameSelector || 'input[name="email"], input[name="username"], input[type="email"]';
    const pass = profile.passwordSelector || 'input[type="password"]';
    const submit = profile.submitSelector || 'button[type="submit"], input[type="submit"]';
    const passwordInput = page.locator(pass).first();
    const form = passwordInput.locator('xpath=ancestor::form[1]');
    const hasForm = (await form.count()) > 0;
    if (hasForm) {
      const action = await form.evaluate((element) => (element as HTMLFormElement).action);
      const actionUrl = new URL(action, effectiveLoginUrl);
      if (actionUrl.origin !== new URL(effectiveLoginUrl).origin)
        throw Error('Cross-origin login form submission is not permitted');
      await assertTargetAllowed(actionUrl.toString(), site);
      approvedLoginActions.add(actionUrl.toString());
    }
    const inputScope = hasForm ? form : page.locator('body');
    const usernameInput = profile.usernameSelector
      ? page.locator(user).first()
      : inputScope.locator(user).first();
    await usernameInput.fill(profile.username, { timeout: site.timeoutMs });
    await passwordInput.fill(decrypt(profile.encryptedPassword), { timeout: site.timeoutMs });
    const submitButton = profile.submitSelector
      ? page.locator(submit).first()
      : inputScope.locator(submit).first();
    await submitButton.click({ timeout: site.timeoutMs });
    // Livewire/SPA forms do not necessarily navigate or emit a new DOMContentLoaded event.
    // Wait for a deterministic success signal; never interpret a public HTTP 200 as login success.
    if (profile.successUrl) {
      await page.waitForURL(profile.successUrl, { timeout: site.timeoutMs });
    } else if (profile.successSelector) {
      await page
        .locator(profile.successSelector)
        .first()
        .waitFor({ state: 'visible', timeout: site.timeoutMs });
    } else {
      await page.waitForFunction(
        ({ loginOrigin, loginPath }) => {
          const current = new URL(window.location.href);
          const moved = current.origin !== loginOrigin || current.pathname !== loginPath;
          const visiblePassword = [...document.querySelectorAll('input[type="password"]')].some(
            (node) => (node as HTMLElement).getClientRects().length > 0,
          );
          return moved && !visiblePassword;
        },
        { loginOrigin: new URL(effectiveLoginUrl).origin, loginPath: new URL(effectiveLoginUrl).pathname },
        { timeout: site.timeoutMs },
      );
    }
    const landingUrl = page.url();
    await assertTargetAllowed(landingUrl, site);
    const passwordVisible = await page
      .locator(pass)
      .first()
      .isVisible()
      .catch(() => false);
    if (
      looksLikeUnauthenticatedPage(landingUrl, effectiveLoginUrl, passwordVisible, effectiveLoginUrl) ||
      passwordVisible
    )
      throw Error('Login not confirmed: browser remains at an authentication form');
    if (profile.startUrl) {
      const landingResponse = await page.goto(profile.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: site.timeoutMs,
      });
      if (landingResponse && [401, 403].includes(landingResponse.status()))
        throw Error(`Authenticated start URL returned HTTP ${landingResponse.status()}`);
      await assertTargetAllowed(page.url(), site);
      const hasPassword = await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (looksLikeUnauthenticatedPage(page.url(), profile.loginUrl, hasPassword, profile.startUrl))
        throw Error(
          'Authentication did not persist when opening the configured start URL. Check cookie domain and login profile.',
        );
    }
    return { storageState: await context.storageState(), landingUrl };
  } catch (error) {
    const reason = redactText(error instanceof Error ? error.message : String(error));
    const visibleText = await page
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch(() => '');
    const loginHint = /this feature is temporarily unavailable/i.test(visibleText)
      ? ' The target displays a temporary-unavailable banner; inspect its server logs.'
      : /(?:invalid credentials|incorrect password|these credentials do not match)/i.test(visibleText)
        ? ' The target reported invalid credentials.'
        : /(?:csrf|session expired|page expired)/i.test(visibleText)
          ? ' The target reported an expired or invalid session.'
          : /(?:two.factor|multi.factor|verification code|one.time password)/i.test(visibleText)
            ? ' The target may require manual MFA.'
            : '';
    const network = loginFailures.slice(0, 3).join('; ');
    const blocked = [...policyBlocked].filter((url) =>
      isApprovedLoginMutation(url, profile.loginUrl, approvedLoginActions),
    );
    const hint = blocked.length
      ? ` Login submission blocked by auditor policy: ${blocked.map((url) => new URL(url).pathname).join(', ')}.`
      : network
        ? ` Login request diagnostics: ${network}.`
        : '';
    throw Error(
      `Authentication failed for profile "${profile.name}": ${reason}.${hint}${loginHint} Check login URL, credentials, selector and server-side login errors.`,
    );
  } finally {
    await context.close();
  }
}

/** Retained for the headed live-inspection CLI. */
export async function loginAndState(
  browser: Browser,
  site: Site,
  profile: AuthProfile,
): Promise<Awaited<ReturnType<BrowserContext['storageState']>>> {
  return (await loginAndSession(browser, site, profile)).storageState;
}

/** Passive DOM-link discovery: do not click controls (even sidebar toggles can invoke Livewire actions). */
export async function discoverNavigationLinks(
  page: import('playwright').Page,
  mode: 'navigation' | 'all-links' = 'navigation',
): Promise<string[]> {
  // This reads existing links without clicking Filament/Livewire controls.
  // In navigation mode, record/table links are intentionally excluded.
  const selector =
    mode === 'all-links'
      ? 'a[href]'
      : [
          'nav a[href]',
          '[role="navigation"] a[href]',
          'header a[href]',
          'footer a[href]',
          '.fi-sidebar a[href]',
          '.fi-topbar a[href]',
          '[data-sidebar] a[href]',
          '[data-navigation] a[href]',
        ].join(', ');
  return page
    .locator(selector)
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => !(node as HTMLAnchorElement).hasAttribute('download'))
        .map((node) => (node as HTMLAnchorElement).href),
    )
    .catch(() => []);
}

export async function scanPage(
  browser: Browser,
  site: Site,
  scan: Scan,
  url: string,
  depth: number,
  storageState?: Awaited<ReturnType<BrowserContext['storageState']>>,
  loginUrl?: string,
): Promise<{ result: PageResult; links: string[] }> {
  await recordScanEvent(
    scan._id!.toString(),
    scan.siteId,
    'navigation',
    'Opening page in Chromium.',
    'info',
    undefined,
    url,
  );
  const started = Date.now(),
    errors: string[] = [],
    consoleErrors: string[] = [],
    failedRequests: PageResult['failedRequests'] = [],
    issues: PageResult['issues'] = [];
  const policyBlocked = new Set<string>(),
    policyBlockReasons = new Map<string, string>(),
    allowedPassiveLivewire = new Set<string>(),
    allowedBrowserLivewire = new Set<string>(),
    resources: ResourceTiming[] = [],
    pendingResourceTasks = new Set<Promise<void>>();
  const context = await browser.newContext({
    ignoreHTTPSErrors: site.ignoreHTTPSErrors,
    storageState,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  });
  await configureContext(
    context,
    site,
    false,
    undefined,
    policyBlocked,
    undefined,
    allowedPassiveLivewire,
    allowedBrowserLivewire,
    url,
    policyBlockReasons,
  );
  await context.addInitScript(() => {
    try {
      const tracker = window as typeof window & { __auditorLcp?: number };
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tracker.__auditorLcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      /* unsupported in this browser context */
    }
  });
  if (site.captureTraces) await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  // Track page-critical network requests; do not treat DOMContentLoaded as fully rendered.
  const inFlight = new Set<Request>();
  let lastNetworkActivityAt = Date.now();
  const isCriticalRequest = (request: Request): boolean => {
    if (!/^https?:/i.test(request.url())) return false;
    if (!['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(request.resourceType())) return false;
    try {
      return new URL(request.url()).origin === new URL(url).origin;
    } catch {
      return false;
    }
  };
  page.on('request', (request) => {
    if (isCriticalRequest(request)) {
      inFlight.add(request);
      lastNetworkActivityAt = Date.now();
    }
  });
  const finishedRequest = (request: Request) => {
    if (inFlight.delete(request)) lastNetworkActivityAt = Date.now();
  };
  page.on('requestfinished', finishedRequest);
  page.on('requestfailed', finishedRequest);
  page.on('pageerror', (e) => errors.push(redactText(normalizeBrowserError(e)).slice(0, 900)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(redactText(m.text()).slice(0, 800));
  });
  page.on('requestfailed', (r) => {
    if (/^https?:/.test(r.url())) {
      failedRequests.push({ url: redactUrl(r.url()), method: r.method(), failure: r.failure()?.errorText });
      resources.push(
        resourceFromPlaywright({
          url: redactUrl(r.url()),
          method: r.method(),
          type: r.resourceType(),
          failure: r.failure()?.errorText,
          timing: r.timing(),
        }),
      );
    }
  });
  page.on('requestfinished', (r) => {
    const task = (async () => {
      if (!/^https?:/.test(r.url())) return;
      const response = await r.response().catch(() => null);
      resources.push(
        resourceFromPlaywright({
          url: redactUrl(r.url()),
          method: r.method(),
          type: r.resourceType(),
          status: response?.status(),
          timing: r.timing(),
        }),
      );
    })();
    pendingResourceTasks.add(task);
    void task.finally(() => pendingResourceTasks.delete(task));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.request().resourceType() !== 'document')
      failedRequests.push({ url: r.url(), method: r.request().method(), status: r.status() });
  });
  let status: number | undefined,
    initialStatus: number | undefined,
    title = '',
    finalUrl = url,
    original = '',
    rendered = '',
    links: string[] = [],
    redirectChain: PageResult['redirects'] = [];
  let response: Response | null = null;
  const performance: PageTiming = { resources };
  let pageReadyMs = 0;
  let networkSettled = false;
  let pendingAtCapture = 0;
  try {
    await assertTargetAllowed(url, site);
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: site.timeoutMs });
    // A networkidle timeout is not evidence of readiness (or failure). Livewire
    // may initialize asynchronously after DOMContentLoaded; await a quiet period
    // on relevant same-origin requests, with a hard bounded deadline.
    await page.waitForLoadState('load', { timeout: Math.min(site.timeoutMs, 12000) }).catch(() => {});
    const settleStarted = Date.now();
    const settleBudgetMs = Math.min(15000, Math.max(5000, site.timeoutMs));
    while (Date.now() - settleStarted < settleBudgetMs) {
      if (
        inFlight.size === 0 &&
        Date.now() - lastNetworkActivityAt >= 900 &&
        Date.now() - settleStarted >= 1000
      ) {
        networkSettled = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    performance.settleMs = Date.now() - settleStarted;
    performance.settleTimedOut = !networkSettled;
    pendingAtCapture = inFlight.size;
    performance.pendingRequestsAtCapture = pendingAtCapture;
    if (!networkSettled) {
      await recordScanEvent(
        scan._id!.toString(),
        scan.siteId,
        'settling',
        `Page readiness budget reached; ${inFlight.size} first-party request(s) still in flight.`,
        'warning',
        undefined,
        url,
      );
    }

    status = response?.status();
    initialStatus = status;
    finalUrl = page.url();
    title = await page.title().catch(() => '');
    await assertTargetAllowed(finalUrl, site);
    const chain: Array<{ url: string; status: number }> = [];
    let request = response?.request();
    while (request?.redirectedFrom()) {
      const prior = request.redirectedFrom()!;
      const r = await prior.response();
      chain.unshift({ url: prior.url(), status: r?.status() || 0 });
      request = prior;
    }
    redirectChain = chain;
    initialStatus = chain[0]?.status ?? status;
    original = (await response?.text().catch(() => '')) || '';
    rendered = await page.content();
    if (!status || status >= 400)
      issues.push({ category: 'http', message: `Main document HTTP ${status || 'no response'}` });
    if (loginUrl) {
      const passwordVisible = await page
        .locator('input[type="password"]')
        .first()
        .isVisible()
        .catch(() => false);
      if (looksLikeUnauthenticatedPage(finalUrl, loginUrl, passwordVisible, url))
        issues.push({ category: 'authentication', message: 'Session expired or redirect to login form' });
    }
    const visibleText = await page
      .locator('body')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    if (
      /this feature is temporarily unavailable|please wait a moment and try again/i.test(
        visibleText.slice(0, 2000),
      )
    )
      issues.push({
        category: 'framework',
        message: 'Visible temporary-unavailable error displayed despite HTTP success',
      });
    if (visibleText.trim().length < 12)
      issues.push({ category: 'render', message: 'Blank or nearly blank page body' });
    if (
      /(?:Whoops!|exception occurred|Server Error|Internal Server Error|Application error: a client-side exception)/i.test(
        visibleText.slice(0, 3000),
      )
    )
      issues.push({ category: 'framework', message: 'Visible exception/error page' });
    const brokenImages = await page
      .evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth === 0).length)
      .catch(() => 0);
    if (brokenImages > 0)
      issues.push({ category: 'assets', message: `${brokenImages} broken image(s) detected` });
    const bodyOverflow = await page
      .evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 10)
      .catch(() => false);
    if (bodyOverflow) issues.push({ category: 'ui', message: 'Horizontal viewport overflow' });
    links = await discoverNavigationLinks(page, site.discoveryMode || 'navigation');
    const metrics = await page
      .evaluate(() => {
        const nav = window.performance.getEntriesByType('navigation')[0] as
          PerformanceNavigationTiming | undefined;
        const paints = window.performance.getEntriesByType('paint');
        const fcp = paints.find((p) => p.name === 'first-contentful-paint');
        const lcp = (window as typeof window & { __auditorLcp?: number }).__auditorLcp;
        if (!nav)
          return {
            fcp: fcp?.startTime,
            lcp,
            dom: undefined,
            load: undefined,
            dns: undefined,
            connect: undefined,
            tls: undefined,
            ttfb: undefined,
            download: undefined,
            redirect: undefined,
          };
        return {
          fcp: fcp?.startTime,
          lcp,
          dom: nav.domContentLoadedEventEnd,
          load: nav.loadEventEnd,
          dns: nav.domainLookupEnd - nav.domainLookupStart,
          connect: nav.connectEnd - nav.connectStart,
          tls: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : undefined,
          ttfb: nav.responseStart - nav.requestStart,
          download: nav.responseEnd - nav.responseStart,
          redirect: nav.redirectEnd > 0 ? nav.redirectEnd - nav.redirectStart : undefined,
        };
      })
      .catch(() => null);
    if (metrics) {
      const round = (n?: number) =>
        n === undefined || !Number.isFinite(n) || n < 0 ? undefined : Math.round(n);
      performance.domContentLoadedMs = round(metrics.dom);
      performance.loadEventMs = round(metrics.load);
      performance.firstContentfulPaintMs = round(metrics.fcp);
      performance.largestContentfulPaintMs = round(metrics.lcp);
      performance.navigation = {
        dnsMs: round(metrics.dns),
        connectMs: round(metrics.connect),
        tlsMs: round(metrics.tls),
        ttfbMs: round(metrics.ttfb),
        downloadMs: round(metrics.download),
        redirectMs: round(metrics.redirect),
      };
    }
  } catch (e) {
    issues.push({
      category: 'navigation',
      message: redactText(e instanceof Error ? e.message : String(e)).slice(0, 900),
    });
    rendered = await page.content().catch(() => '');
    finalUrl = page.url();
  }
  for (const m of errors.slice(0, 20)) issues.push({ category: 'javascript', message: m });
  // Inspector errors and deliberate blocked requests are browser/scan-policy noise, not proof of a broken website.
  const diagnostics = classifyBrowserDiagnostics(
    consoleErrors,
    failedRequests,
    new Set([...policyBlocked].map(redactUrl)),
  );
  for (const m of diagnostics.actionableConsole
    .filter((m) => /hydration|uncaught|error|failed/i.test(m))
    .slice(0, 15))
    issues.push({ category: 'console', message: m });
  for (const r of diagnostics.actionableRequests
    .filter(
      (r) =>
        (r.status && r.status >= 400 && (r.status >= 500 || [401, 403, 404, 419, 422].includes(r.status))) ||
        r.failure,
    )
    .slice(0, 20)) {
    const critical =
      [401, 403, 419, 422].includes(r.status || 0) ||
      (r.status || 0) >= 500 ||
      /\.(?:js|css)(?:\?|$)/i.test(r.url) ||
      /livewire|_next|api\//i.test(r.url);
    // Chromium may abort an in-flight stylesheet during navigation/context teardown.
    // Keep it in the network evidence and as a warning, not a confirmed site failure.
    const navigationAbort = /\bERR_ABORTED\b/i.test(r.failure || '') && !r.status;
    if (critical && !navigationAbort)
      issues.push({
        category: 'network',
        message: `Subrequest ${r.status ?? r.failure ?? 'failed'}: ${r.url}`.slice(0, 500),
      });
  }
  if (allowedBrowserLivewire.size) {
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'framework',
      `${allowedBrowserLivewire.size} same-origin Livewire endpoint(s) allowed in browser-faithful mode (non-production, explicitly opted in).`,
      'info',
      undefined,
      url,
    );
  }
  if (allowedPassiveLivewire.size) {
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'framework',
      `${allowedPassiveLivewire.size} passive Livewire request endpoint(s) were permitted by the site's development compatibility setting.`,
      'info',
      undefined,
      url,
    );
  }
  const policyWarnings = [...policyBlocked]
    .filter((blocked) => /\/livewire(?:-[a-z\d]+)?\/(?:update|message)/i.test(new URL(blocked).pathname))
    .map(
      () =>
        'Livewire background request blocked by safe crawl policy. For an authorized local/staging site, review the optional Livewire compatibility setting.',
    );
  const warnings = [...new Set(policyWarnings)];
  if (performance.settleTimedOut)
    warnings.push(
      `Page readiness budget reached; ${pendingAtCapture} relevant request(s) remained in flight. Rendering may be incomplete.`,
    );
  const warning =
    warnings.length > 0 ||
    diagnostics.actionableRequests.length > 0 ||
    diagnostics.actionableConsole.length > 0 ||
    redirectChain.length > 0;
  if (diagnostics.ignoredConsole.length || diagnostics.policyBlocked.length) {
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'diagnostics',
      `${diagnostics.ignoredConsole.length} Inspector console signal(s) ignored; ${diagnostics.policyBlocked.length} browser/policy blocked request(s) excluded from failure grading.`,
      'info',
      undefined,
      url,
    );
  }
  const preliminaryClassification = issues.length ? 'failed' : warning ? 'warning' : 'passed';
  pageReadyMs = Date.now() - started;
  performance.pageReadyMs = pageReadyMs;
  await Promise.allSettled([...pendingResourceTasks]);
  performance.resources = resources.sort((a, b) => b.durationMs - a.durationMs).slice(0, 500);
  const pageId = new ObjectId();
  const prefix = `websites/${site._id}/scans/${scan._id}/pages/${pageId}`;
  const evidence: Record<string, string> = {};
  if (issues.length || warning || site.captureHealthy || scan.mode === 'retry') {
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'evidence',
      'Capturing sanitized HTML, screenshot and network diagnostics.',
      'info',
      undefined,
      url,
    );
    try {
      evidence.original = await putEvidence(`${prefix}/original.html`, redactHtml(original), 'text/html');
    } catch {
      issues.push({ category: 'evidence', message: 'Failed to save original HTML' });
    }
    try {
      evidence.rendered = await putEvidence(`${prefix}/rendered.html`, redactHtml(rendered), 'text/html');
    } catch {
      issues.push({ category: 'evidence', message: 'Failed to save rendered HTML' });
    }
    try {
      evidence.screenshot = await putEvidence(
        `${prefix}/screenshot.png`,
        await page.screenshot({ fullPage: true, timeout: 10000 }),
        'image/png',
      );
    } catch {
      /* navigation error may prevent screenshots */
    }
    if (site.captureTraces) {
      const tmp = await mkdtemp(join(tmpdir(), 'auditor-trace-'));
      try {
        const tracePath = join(tmp, 'trace.zip');
        await context.tracing.stop({ path: tracePath });
        evidence.trace = await putEvidence(
          `${prefix}/trace.zip`,
          await readFile(tracePath),
          'application/zip',
        );
      } catch {
        issues.push({ category: 'evidence', message: 'Could not capture browser trace' });
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }
    try {
      evidence.console = await putEvidence(
        `${prefix}/console.json`,
        JSON.stringify({ consoleErrors, errors, ignoredInspectorSignals: diagnostics.ignoredConsole }),
        'application/json',
      );
      evidence.network = await putEvidence(
        `${prefix}/network.json`,
        JSON.stringify({
          failedRequests,
          policyBlocked: diagnostics.policyBlocked,
          policyBlockReasons: [...policyBlockReasons].slice(0, 30).map(([requestUrl, reason]) => ({
            url: redactUrl(requestUrl),
            reason: redactText(reason).slice(0, 200),
          })),
          allowedPassiveLivewire: [...allowedPassiveLivewire].map(redactUrl),
          allowedBrowserLivewire: [...allowedBrowserLivewire].map(redactUrl),
          readiness: {
            settled: networkSettled,
            settleMs: performance.settleMs,
            pendingRequestsAtCapture: pendingAtCapture,
          },
          redirectChain,
          resources: performance.resources,
        }),
        'application/json',
      );
    } catch {
      /* reported in operation logs */
    }
  }
  performance.captureAndStorageMs = Math.max(0, Date.now() - started - pageReadyMs);
  const graded = gradePageWithPolicy(issues, warnings, policyBlocked);
  if (graded.classification === 'warning' && preliminaryClassification === 'failed')
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'inconclusive',
      'Scan policy blocked a Livewire request while the page displayed errors. Evidence preserved; site failure not independently confirmed.',
      'warning',
      undefined,
      url,
    );
  const result: PageResult = {
    _id: pageId,
    scanId: scan._id!.toString(),
    siteId: site._id!.toString(),
    authProfileId: scan.authProfileId,
    url,
    finalUrl,
    depth,
    status,
    initialStatus,
    redirects: redirectChain,
    title,
    durationMs: pageReadyMs,
    performance,
    classification: graded.issues.length ? 'failed' : graded.classification,
    issues: graded.issues,
    warnings: graded.warnings,
    consoleErrors,
    pageErrors: errors,
    failedRequests,
    evidence,
    capturedAt: new Date(),
    discoveredLinks: links.slice(0, 1000),
  };
  if (site.captureTraces && !evidence.trace) await context.tracing.stop().catch(() => {});
  await context.close();
  return { result, links };
}

export async function executeScan(
  scan: Scan,
  owner: string,
): Promise<'completed' | 'completed_with_errors' | 'completed_partial' | 'cancelled'> {
  const db = await database();
  const site = await db.collection<Site>('sites').findOne({ _id: new ObjectId(scan.siteId) });
  if (!site) throw Error(`Site ${scan.siteId} not found`);
  const effectiveSite = { ...site, ...scan.options };
  await recordScanEvent(
    scan._id!.toString(),
    scan.siteId,
    'policy',
    `Livewire transport: ${
      effectiveSite.environment !== 'production' && effectiveSite.allowLivewireBackground
        ? 'browser-faithful (opt-in enabled)'
        : effectiveSite.environment !== 'production' && effectiveSite.allowPassiveLivewire
          ? 'passive compatibility (restricted)'
          : 'strict safe crawl (background mutations blocked)'
    }. ` + `Browser contexts are isolated per route; concurrency=${effectiveSite.concurrency}.`,
    'info',
    owner,
  );
  const hardLimit = Math.min(100000, Math.max(100, Number(process.env.AUTO_PAGE_SAFETY_LIMIT || 10000)));
  const maxPages = effectiveSite.maxPages === 0 ? hardLimit : effectiveSite.maxPages;
  const deadline = Date.now() + Math.max(60000, Number(process.env.SCAN_TIME_BUDGET_MS || 3600000));
  const profile = scan.authProfileId
    ? await db
        .collection<AuthProfile>('profiles')
        .findOne({ _id: new ObjectId(scan.authProfileId), siteId: scan.siteId })
    : null;
  if (scan.authProfileId && !profile) throw Error('Authentication profile not found');
  await recordScanEvent(
    scan._id!.toString(),
    scan.siteId,
    'browser',
    'Launching Chromium browser.',
    'info',
    owner,
  );
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  try {
    if (profile)
      await recordScanEvent(
        scan._id!.toString(),
        scan.siteId,
        'authentication',
        `Signing in using profile ${profile.name}.`,
        'info',
        owner,
      );
    const session = profile ? await loginAndSession(browser, effectiveSite, profile) : undefined;
    let state = session?.storageState;
    if (profile && session) {
      const landing = chooseAuthenticatedSeed(profile.startUrl, session.landingUrl, site.baseUrl);
      await assertTargetAllowed(landing, effectiveSite);
      await db
        .collection<Scan>('scans')
        .updateOne(
          { _id: scan._id, leaseOwner: owner },
          { $set: { authProfileName: profile.name, authenticatedLandingUrl: redactUrl(landing) } },
        );
      await recordScanEvent(
        scan._id!.toString(),
        scan.siteId,
        'authenticated',
        `Authentication confirmed for ${profile.name}; starting discovery at ${redactUrl(landing)}.`,
        'info',
        owner,
        landing,
      );
    }
    const initial =
      scan.mode === 'retry' || scan.mode === 'import'
        ? scan.urls || []
        : [
            profile && session
              ? chooseAuthenticatedSeed(profile.startUrl, session.landingUrl, site.baseUrl)
              : site.baseUrl,
          ];
    const authSeed =
      profile && session
        ? chooseAuthenticatedSeed(profile.startUrl, session.landingUrl, site.baseUrl)
        : undefined;
    const eligibleForDiscovery = (url: string): boolean =>
      !authSeed ||
      !profile ||
      scan.mode !== 'crawl' ||
      isAuthenticatedDiscoveryCandidate(url, authSeed, profile.loginUrl, site.baseUrl);
    const queue = initial.map((url) => ({ url, depth: 0 }));
    const seen = new Set<string>(),
      existing = await db.collection<PageResult>('pages').find({ scanId: scan._id!.toString() }).toArray();
    for (const p of existing) seen.add(p.url);
    if (scan.mode === 'crawl')
      for (const p of existing)
        if (p.depth < effectiveSite.maxDepth)
          for (const raw of p.discoveredLinks || []) {
            const link = canonicalLink(raw, p.url);
            if (
              link &&
              eligibleForDiscovery(link) &&
              !seen.has(link) &&
              !queue.some((v) => v.url === link) &&
              isSafeLink(link) &&
              isCrawlablePageUrl(link)
            )
              queue.push({ url: link, depth: p.depth + 1 });
          }
    let cancelled = false,
      limited = false;
    while (queue.length && seen.size < maxPages) {
      if (Date.now() > deadline) {
        limited = true;
        await recordScanEvent(
          scan._id!.toString(),
          scan.siteId,
          'limit',
          'Time budget reached; remaining pages were not scanned.',
          'warning',
          owner,
        );
        break;
      }
      const current = await db.collection<Scan>('scans').findOne({ _id: scan._id });
      if (
        !current ||
        current.leaseOwner !== owner ||
        current.cancelRequested ||
        current.status === 'cancelled'
      ) {
        cancelled = true;
        break;
      }
      if (current.status === 'paused') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const batch: typeof queue = [];
      while (
        queue.length &&
        batch.length < effectiveSite.concurrency &&
        seen.size + batch.length < maxPages
      ) {
        const next = queue.shift()!;
        if (seen.has(next.url)) continue;
        try {
          await assertTargetAllowed(next.url, effectiveSite);
        } catch {
          continue;
        }
        if (!isSafeLink(next.url) || !isCrawlablePageUrl(next.url) || !eligibleForDiscovery(next.url))
          continue;
        seen.add(next.url);
        batch.push(next);
      }
      if (!batch.length) break;
      await updateProgress(scan._id!, owner, {
        discovered: seen.size + queue.length,
        currentUrl: batch[0].url,
      });
      await recordScanEvent(
        scan._id!.toString(),
        scan.siteId,
        'browsing',
        `Visiting ${batch.length} page(s) in this batch.`,
        'info',
        owner,
        batch[0].url,
      );
      await Promise.all(
        batch.map(async (entry) => {
          try {
            let { result, links } = await scanPage(
              browser,
              effectiveSite,
              scan,
              entry.url,
              entry.depth,
              state,
              profile?.loginUrl,
            );
            if (profile && result.issues.some((i) => i.category === 'authentication')) {
              state = (await loginAndSession(browser, effectiveSite, profile)).storageState;
              ({ result, links } = await scanPage(
                browser,
                effectiveSite,
                scan,
                entry.url,
                entry.depth,
                state,
                profile.loginUrl,
              ));
            }
            await db
              .collection<PageResult>('pages')
              .updateOne({ scanId: result.scanId, url: result.url }, { $set: result }, { upsert: true });
            await recordPageIssues(result);
            await recordScanEvent(
              scan._id!.toString(),
              scan.siteId,
              'page',
              `HTTP ${result.status ?? 'no response'} · ${result.classification} · ${result.durationMs}ms`,
              result.classification === 'failed'
                ? 'error'
                : result.classification === 'warning'
                  ? 'warning'
                  : 'info',
              owner,
              entry.url,
            );
            if (scan.mode === 'crawl' && entry.depth < effectiveSite.maxDepth)
              for (const raw of links) {
                const link = canonicalLink(raw, entry.url);
                if (
                  link &&
                  eligibleForDiscovery(link) &&
                  !seen.has(link) &&
                  !queue.some((item) => item.url === link) &&
                  isSafeLink(link) &&
                  isCrawlablePageUrl(link)
                ) {
                  try {
                    await assertTargetAllowed(link, effectiveSite);
                    queue.push({ url: link, depth: entry.depth + 1 });
                  } catch {
                    /* out of scope */
                  }
                }
              }
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            console.error('Page processing error:', redactText(err));
            const result: PageResult = {
              _id: new ObjectId(),
              scanId: scan._id!.toString(),
              siteId: site._id!.toString(),
              authProfileId: scan.authProfileId,
              url: entry.url,
              finalUrl: entry.url,
              depth: entry.depth,
              redirects: [],
              title: '',
              durationMs: 0,
              classification: 'failed',
              issues: [{ category: 'scanner', message: redactText(err).slice(0, 800) }],
              consoleErrors: [],
              pageErrors: [],
              failedRequests: [],
              evidence: {},
              capturedAt: new Date(),
            };
            await db
              .collection<PageResult>('pages')
              .updateOne({ scanId: result.scanId, url: result.url }, { $set: result }, { upsert: true });
            await recordPageIssues(result);
            await recordScanEvent(
              scan._id!.toString(),
              scan.siteId,
              'page',
              `Page processing failed: ${redactText(err).slice(0, 250)}`,
              'error',
              owner,
              entry.url,
            );
          }
        }),
      );
      const pages = await db.collection<PageResult>('pages').find({ scanId: scan._id!.toString() }).toArray();
      await updateProgress(scan._id!, owner, {
        discovered: seen.size + queue.length,
        visited: pages.length,
        passed: pages.filter((p) => p.classification === 'passed').length,
        failed: pages.filter((p) => p.classification === 'failed').length,
        warnings: pages.filter((p) => p.classification === 'warning').length,
        currentUrl: batch.at(-1)?.url,
      });
    }
    if (cancelled) return 'cancelled';
    if (queue.length) {
      limited = true;
      await recordScanEvent(
        scan._id!.toString(),
        scan.siteId,
        'limit',
        `${queue.length} discovered page(s) were not scanned due to the configured limits.`,
        'warning',
        owner,
      );
    }
    const pages = await db.collection<PageResult>('pages').find({ scanId: scan._id!.toString() }).toArray();
    // Report persistence is awaited before the scan is marked completed.
    await recordScanEvent(
      scan._id!.toString(),
      scan.siteId,
      'report',
      'Persisting HTML/JSON/CSV reports to RustFS.',
      'info',
      owner,
    );
    const { persistReports } = await import('../src/lib/reports');
    const keys = await persistReports(site, scan, pages);
    await db
      .collection<Scan>('scans')
      .updateOne({ _id: scan._id, leaseOwner: owner }, { $set: { reportKeys: keys } });
    return pages.some((p) => p.classification === 'failed')
      ? 'completed_with_errors'
      : limited
        ? 'completed_partial'
        : 'completed';
  } finally {
    await browser.close();
  }
}
