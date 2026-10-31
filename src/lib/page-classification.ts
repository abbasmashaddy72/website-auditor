import { findingSeverity } from './finding-severity';
import type { PageResult } from './types';

export type Classification = PageResult['classification'];
export type ClassificationEvidence = Pick<PageResult, 'status' | 'issues' | 'warnings'> & {
  expectedAuthentication?: boolean;
};

/** Fatal diagnostic text is not a non-fatal warning simply because the HTTP response is 2xx. */
export function isFatalWarning(message: string): boolean {
  return /\b(?:uncaught|exception|authentication failed|authentication not confirmed|network error|temporar(?:ily|y)[ -]unavailable|HTTP [45]\d\d)\b/i.test(
    message,
  );
}

/** HTTP 2xx alone never proves a page is healthy. Count fatal errors independently of warnings. */
export function classifyPageEvidence(page: ClassificationEvidence): Classification {
  const status = page.status;
  if (!status || status >= 500 || (status >= 400 && !page.expectedAuthentication)) return 'failed';
  if ((page.warnings || []).some(isFatalWarning)) return 'failed';
  if (
    page.issues.some(
      (issue) =>
        !(page.expectedAuthentication && ['authentication-expected', 'render'].includes(issue.category)) &&
        findingSeverity({ ...issue, latestHttpStatus: status }) === 'error',
    )
  )
    return 'failed';
  return page.issues.length > 0 || (page.warnings?.length ?? 0) > 0 || status >= 300 ? 'warning' : 'passed';
}

/** Reclassify only a conclusive non-fatal failure. Missing or ambiguous data must not be rewritten. */
export function historicalWarningCandidate(
  page: ClassificationEvidence & { classification: Classification },
): boolean {
  return (
    page.classification === 'failed' &&
    (page.issues.length > 0 || (page.warnings?.length ?? 0) > 0) &&
    typeof page.status === 'number' &&
    page.status >= 200 &&
    page.status < 300 &&
    classifyPageEvidence(page) === 'warning'
  );
}
