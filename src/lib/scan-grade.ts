import { classifyPageEvidence } from './page-classification';
import type { PageResult } from './types';

export function normalizeBrowserError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.trim() === 'Object')
      return 'Unstructured JavaScript exception (Object thrown without a descriptive message; inspect browser trace and app logs)';
    const detail =
      error.stack && error.stack !== error.message ? error.stack : `${error.name}: ${error.message}`;
    return detail.slice(0, 900);
  }
  if (typeof error === 'string') return error;
  try {
    return `Non-Error browser rejection: ${JSON.stringify(error)}`.slice(0, 900);
  } catch {
    return 'Non-Error browser rejection (unserializable)';
  }
}

/** Scanner-induced Livewire blocks can make a page look broken; report it as inconclusive, not verified failed. */
export function gradePageWithPolicy(
  issues: PageResult['issues'],
  warnings: string[],
  blockedUrls: Iterable<string>,
  httpStatus?: number,
  expectedAuthentication = false,
): { issues: PageResult['issues']; warnings: string[]; classification: PageResult['classification'] } {
  const livewireBlocked = [...blockedUrls].some((url) =>
    /\/livewire(?:-[a-z\d]+)?\/(?:update|message)/i.test(url),
  );
  if (!livewireBlocked)
    return {
      issues,
      warnings,
      classification: classifyPageEvidence({ status: httpStatus, issues, warnings, expectedAuthentication }),
    };
  const kept: PageResult['issues'] = [];
  let uncertain = false;
  for (const issue of issues) {
    const likelyArtifact =
      (issue.category === 'framework' && /temporar(?:ily|y)[ -]unavailable/i.test(issue.message)) ||
      ((issue.category === 'javascript' || issue.category === 'console') &&
        /^(?:object|error: object|uncaught object|unstructured javascript exception)(?:$|\n|\s|\()/i.test(
          issue.message.trim(),
        ));
    if (likelyArtifact) uncertain = true;
    else kept.push(issue);
  }
  const notes = [...warnings];
  if (uncertain)
    notes.push(
      'Inconclusive: scanner blocked a Livewire update while a runtime/error banner appeared. Recheck without blocking required framework requests in an explicitly authorized isolated test environment.',
    );
  return {
    issues: kept,
    warnings: [...new Set(notes)],
    classification: classifyPageEvidence({
      status: httpStatus,
      issues: kept,
      warnings: [...new Set(notes)],
      expectedAuthentication,
    }),
  };
}
