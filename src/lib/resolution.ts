import type { Filter } from 'mongodb';
import type { Issue, PageResult } from './types';

/** A warning, inconclusive capture, or HTTP 200 with errors cannot resolve a finding. */
export function canVerifyResolution(page: PageResult): boolean {
  return (
    page.classification === 'passed' &&
    page.issues.length === 0 &&
    (page.warnings?.length ?? 0) === 0 &&
    page.status !== undefined &&
    page.status >= 200 &&
    page.status < 300 &&
    Boolean(page._id)
  );
}

/** Link to a new successful observation without overwriting original failure evidence. */
export function verifiedSnapshot(page: PageResult) {
  if (!canVerifyResolution(page)) throw new Error('Page is not independently verified as healthy');
  return {
    at: page.capturedAt,
    scanId: page.scanId,
    pageId: page._id!.toString(),
    httpStatus: page.status,
  };
}

/** Atomic matching scope: an older retry cannot resolve a newer active failure. */
export function activeFindingsForVerification(page: PageResult): Filter<Issue> {
  if (!canVerifyResolution(page)) throw new Error('Cannot resolve findings from unverified page');
  return {
    siteId: page.siteId,
    ...(page.authProfileId
      ? { authProfileId: page.authProfileId }
      : {
          $or: [
            { authProfileId: { $exists: false } },
            { authProfileId: '' },
            { authProfileId: { $type: 'null' } },
          ],
        }),
    url: page.url,
    status: { $in: ['open', 'reopened'] },
    lastDetectedAt: { $lte: page.capturedAt },
  };
}
