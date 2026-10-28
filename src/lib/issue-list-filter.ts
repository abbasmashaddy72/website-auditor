import type { Filter } from 'mongodb';
import type { Issue } from './types';

/** Active Errors is the default; resolved and Manual Review are separate views. */
export function issueListFilter(status?: string | null, siteId?: string | null): Filter<Issue> {
  const filter: Filter<Issue> = {};
  if (siteId) filter.siteId = siteId;
  switch (status || 'active') {
    case 'active':
      filter.status = { $in: ['open', 'reopened'] };
      break;
    case 'resolved':
      filter.status = 'verified_resolved';
      break;
    case 'manual_review':
      filter.status = 'manual_review';
      break;
    case 'review_history':
      filter.$or = [{ status: 'manual_review' }, { reviewHistory: { $exists: true } }];
      break;
    case 'all':
      break; // Explicit administrator request for all historical statuses.
    default:
      throw Error('Unknown finding status filter');
  }
  return filter;
}
