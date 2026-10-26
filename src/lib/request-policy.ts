/** Conservative request-policy decisions for authorized browser scans. */
export function isLivewireUpdateEndpoint(raw: string): boolean {
  try {
    const path = new URL(raw).pathname;
    // Livewire 3 may be mounted at /livewire-<hash>/update by Laravel applications.
    return /^\/livewire(?:-[a-z\d]+)?\/(?:update|message(?:\/[^/]+)?)(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

export function isApprovedLoginMutation(
  url: string,
  loginUrl: string,
  formActions: ReadonlySet<string>,
): boolean {
  const request = new URL(url);
  const login = new URL(loginUrl);
  if (request.origin !== login.origin) return false;
  if (isLivewireUpdateEndpoint(url)) return true;
  if (request.pathname === login.pathname) return true;
  return [...formActions].some((entry) => {
    const form = new URL(entry);
    return request.origin === form.origin && request.pathname === form.pathname;
  });
}

/** Only hydration requests with *no* component calls and *no* field changes are known read-only. */
export function isReadOnlyLivewireHydration(url: string, method: string, body: string | null): boolean {
  if (method.toUpperCase() !== 'POST' || !isLivewireUpdateEndpoint(url) || !body || body.length > 200000)
    return false;
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const components = (payload as { components?: unknown }).components;
    return (
      Array.isArray(components) &&
      components.length > 0 &&
      components.length <= 20 &&
      components.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        const component = entry as { calls?: unknown; updates?: unknown };
        // Livewire 3 reserves __lazyLoad for lazy component hydration; ordinary
        // user-defined calls (save, delete, submit, etc.) remain blocked.
        return (
          Array.isArray(component.calls) &&
          component.calls.every((call: unknown) => {
            if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
            const method = (call as { method?: unknown }).method;
            return method === '__lazyLoad';
          }) &&
          component.updates !== null &&
          typeof component.updates === 'object' &&
          !Array.isArray(component.updates) &&
          Object.keys(component.updates).length === 0
        );
      })
    );
  } catch {
    return false;
  }
}

/**
 * Opt-in compatibility for passive first-party Livewire background traffic.
 * This is NOT a proof of side-effect freedom: user-defined Livewire methods can
 * mutate server state regardless of their name. Enable only for explicitly
 * authorized local/staging targets. The auditor never invokes these calls.
 */
export function isPassiveLivewireUpdate(
  url: string,
  pageUrl: string,
  method: string,
  body: string | null,
): boolean {
  if (method.toUpperCase() !== 'POST' || !isLivewireUpdateEndpoint(url) || !body || body.length > 200000)
    return false;
  try {
    if (new URL(url).origin !== new URL(pageUrl).origin) return false;
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const components = (payload as { components?: unknown }).components;
    if (!Array.isArray(components) || !components.length || components.length > 20) return false;
    return components.every((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const component = entry as { calls?: unknown; updates?: unknown };
      if (
        !Array.isArray(component.calls) ||
        !component.updates ||
        typeof component.updates !== 'object' ||
        Array.isArray(component.updates) ||
        Object.keys(component.updates).length !== 0
      )
        return false;
      return component.calls.every((call: unknown) => {
        if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
        const name = (call as { method?: unknown }).method;
        if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) return false;
        // Deny clearly action-oriented calls. Unknown calls still require explicit opt-in.
        return !/(?:save|delete|destroy|remove|submit|store|create|update|send|pay|purchase|approve|reject|reset|archive|upload|import|export|execute|trigger|dispatch|logout|login|logout|toggle|set|change|assign|sync|cancel|complete|confirm|mark)/i.test(
          name,
        );
      });
    });
  } catch {
    return false;
  }
}

/**
 * Browser-faithful compatibility is an explicit, non-production opt-in.
 * The page (not the auditor) initiated this same-origin Livewire transport.
 * Its calls may mutate data; the auditor must not click form/action controls.
 * Do not validate a framework-specific JSON shape here: differing Livewire
 * versions and third-party components legitimately use different payloads.
 */
export function isBrowserFaithfulLivewireRequest(
  url: string,
  pageUrl: string,
  method: string,
  body: string | null,
  isNavigationRequest: boolean,
  resourceType: string = 'fetch',
): boolean {
  if (isNavigationRequest || method.toUpperCase() !== 'POST' || !isLivewireUpdateEndpoint(url)) return false;
  if (!['fetch', 'xhr'].includes(resourceType) || !body || body.length > 200000) return false;
  try {
    // Browser-faithful mode permits varying Livewire payload shapes, but a
    // malformed/non-object body is not a valid Livewire component transport.
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const source = new URL(pageUrl);
    const target = new URL(url);
    return ['http:', 'https:'].includes(source.protocol) && source.origin === target.origin;
  } catch {
    return false;
  }
}
