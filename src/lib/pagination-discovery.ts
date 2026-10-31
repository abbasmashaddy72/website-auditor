import type { Page } from 'playwright';
import { safeDiscoveredUrl } from './action-discovery';

/** Construct only a small set of GET pagination routes from explicit Livewire paginator metadata.
 * No wire:click handler, Livewire POST, or page action is executed by discovery.
 */
export function getPaginationRoute(pageUrl: string, wireClick: string, maxSamplePage = 3): string | null {
  const text = wireClick.trim();
  const goto = /^gotoPage\(\s*(\d+)\s*(?:,\s*['"]([a-zA-Z][a-zA-Z0-9_-]{0,49})['"]\s*)?\)$/i.exec(text);
  const next = /^nextPage\(\s*(?:['"]([a-zA-Z][a-zA-Z0-9_-]{0,49})['"]\s*)?\)$/i.exec(text);
  if (!goto && !next) return null;
  const queryName = goto?.[2] || next?.[1] || 'page';
  const url = new URL(pageUrl);
  const current = Number(url.searchParams.get(queryName) || 1);
  const target = goto ? Number(goto[1]) : current + 1;
  if (!Number.isInteger(target) || target < 2 || target > maxSamplePage || target === current) return null;
  url.searchParams.set(queryName, String(target));
  return safeDiscoveredUrl(url.toString(), pageUrl);
}

export async function discoverReadOnlyPagination(page: Page): Promise<string[]> {
  const controls = await page
    .locator(
      [
        '.fi-pagination button',
        '.fi-ta-pagination button',
        'nav[aria-label*="pagination" i] button',
        '[role="navigation"][aria-label*="pagination" i] button',
      ].join(', '),
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node as HTMLElement).getClientRects().length > 0)
        .map((node) => node.getAttribute('wire:click') || '')
        .filter(Boolean),
    )
    .catch(() => [] as string[]);
  return [
    ...new Set(
      controls
        .map((wire) => getPaginationRoute(page.url(), wire))
        .filter((url): url is string => Boolean(url)),
    ),
  ];
}
