import type { Page } from 'playwright';
import { canonicalLink, isCrawlablePageUrl, isSafeLink } from './scope';

/** Only inspect controls that explicitly advertise a menu. Never click a row action by guessing. */
export const MENU_TRIGGER_SELECTOR = [
  'button[aria-haspopup="menu"]',
  '[role="button"][aria-haspopup="menu"]',
  '.fi-dropdown-trigger button',
  '.fi-ta-actions button[aria-expanded]',
  '[data-dropdown-trigger][aria-expanded]',
].join(', ');

const DESTRUCTIVE =
  /\b(?:delete|force.?delete|destroy|remove|pay|payment|charge|submit|save|approve|reject|archive|restore|impersonate|logout|log\s*out|export|import|bulk|send|publish|refund|cancel|sync|execute|run|trigger|reset)\b/i;

export function safeActionLabel(label: string): boolean {
  return !DESTRUCTIVE.test(label);
}

export function safeDiscoveredUrl(raw: string, base: string): string | null {
  const normalized = canonicalLink(raw, base);
  if (!normalized || !isSafeLink(normalized) || !isCrawlablePageUrl(normalized)) return null;
  const url = new URL(normalized);
  try {
    if (DESTRUCTIVE.test(decodeURIComponent(url.pathname))) return null;
  } catch {
    return null;
  }
  const query = url.searchParams;
  for (const [name, value] of query) {
    // Query-driven actions may mutate application state even though the HTTP method is GET.
    if (
      /(?:^|[_-])(?:action|method|command|operation|do)(?:$|[_-])/i.test(name) &&
      !/^(?:view|edit|show|create|details|index|list)$/i.test(value)
    )
      return null;
    if (DESTRUCTIVE.test(name) || DESTRUCTIVE.test(value)) return null;
  }
  return normalized;
}

export function uniqueDiscoveredUrls(raw: readonly string[], base: string, limit = 1000): string[] {
  const urls = new Set<string>();
  for (const link of raw) {
    const url = safeDiscoveredUrl(link, base);
    if (url) urls.add(url);
    if (urls.size >= limit) break;
  }
  return [...urls];
}

export type DiscoveredInteraction = {
  label: string;
  kind: 'modal' | 'drawer' | 'livewire-action';
  executed: false;
};

/** Inspect explicitly labelled menus and a bounded sample of table rows. No action is submitted. */
export async function discoverActionMenus(
  page: Page,
  existingLinks: readonly string[],
  maxMenus = 8,
): Promise<{ links: string[]; interactions: DiscoveredInteraction[] }> {
  const links = new Set(existingLinks);
  const interactions: DiscoveredInteraction[] = [];
  const triggers = page.locator(MENU_TRIGGER_SELECTOR);
  const total = await triggers.count().catch(() => 0);
  // Sample the first rows and a last row, rather than traversing every record's menu.
  const sample =
    total <= maxMenus
      ? Array.from({ length: total }, (_, index) => index)
      : [...Array.from({ length: maxMenus - 1 }, (_, index) => index), total - 1];
  for (const index of sample) {
    const trigger = triggers.nth(index);
    if (!(await trigger.isVisible().catch(() => false))) continue;
    const label = [
      await trigger.getAttribute('aria-label').catch(() => null),
      await trigger.innerText().catch(() => ''),
    ]
      .filter(Boolean)
      .join(' ');
    if (!safeActionLabel(label)) continue;
    // Snapshot visible links first: only newly exposed links belong to this menu.
    const before = new Set(
      await page
        .locator('a[href]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => (node as HTMLElement).getClientRects().length > 0)
            .map((node) => (node as HTMLAnchorElement).href),
        )
        .catch(() => [] as string[]),
    );
    try {
      await trigger.click({ timeout: 1800 });
      const exposed = await page
        .locator('a[href]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => (node as HTMLElement).getClientRects().length > 0)
            .map((node) => ({
              href: (node as HTMLAnchorElement).href,
              text: (node.textContent || '').trim(),
            })),
        )
        .catch(() => [] as Array<{ href: string; text: string }>);
      for (const item of exposed) {
        if (before.has(item.href) || !safeActionLabel(item.text)) continue;
        const url = safeDiscoveredUrl(item.href, page.url());
        if (url) links.add(url);
      }
      // One extra level of explicitly advertised nested menus (bounded, no action execution).
      const nested = page.locator(
        '[role="menu"] [aria-haspopup="menu"], .fi-dropdown-panel [aria-haspopup="menu"]',
      );
      for (let childIndex = 0; childIndex < Math.min(2, await nested.count().catch(() => 0)); childIndex++) {
        const child = nested.nth(childIndex);
        const childLabel = (await child.innerText().catch(() => '')) || '';
        if (!safeActionLabel(childLabel) || !(await child.isVisible().catch(() => false))) continue;
        await child.click({ timeout: 1200 }).catch(() => {});
        const nestedLinks = await page
          .locator('a[href]')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => (node as HTMLElement).getClientRects().length > 0)
              .map((node) => ({
                href: (node as HTMLAnchorElement).href,
                text: (node.textContent || '').trim(),
              })),
          )
          .catch(() => [] as Array<{ href: string; text: string }>);
        for (const item of nestedLinks) {
          if (!safeActionLabel(item.text)) continue;
          const url = safeDiscoveredUrl(item.href, page.url());
          if (url) links.add(url);
        }
      }
      // Livewire mounted actions are not URLs; record their availability without invoking them.
      const buttons = await page
        .locator('[role="menu"] button, .fi-dropdown-panel button, [role="menuitem"]')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => (node as HTMLElement).getClientRects().length > 0)
            .map((node) => ({
              label: (node.textContent || '').trim().slice(0, 100),
              popup: node.getAttribute('aria-haspopup') || '',
              drawer:
                node.hasAttribute('data-drawer-target') ||
                node.getAttribute('aria-controls')?.includes('drawer') === true,
              wire: node.hasAttribute('wire:click') || !!node.closest('[wire\\:click]'),
            })),
        )
        .catch(() => [] as Array<{ label: string; popup: string; drawer: boolean; wire: boolean }>);
      for (const action of buttons) {
        if (!/^(?:view|preview|details|edit)(?:\s|$)/i.test(action.label) || !safeActionLabel(action.label))
          continue;
        const kind =
          action.popup === 'dialog'
            ? 'modal'
            : action.wire
              ? 'livewire-action'
              : action.drawer
                ? 'drawer'
                : null;
        if (!kind) continue;
        if (!interactions.some((entry) => entry.kind === kind && entry.label === action.label))
          interactions.push({ label: action.label, kind, executed: false });
      }
    } catch {
      // An inaccessible menu is not a functional site failure. Never fall back to an action click.
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  return { links: [...links].slice(0, 1000), interactions: interactions.slice(0, 30) };
}
