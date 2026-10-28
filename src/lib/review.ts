/** Current review state is separate from immutable observations and scan results. */
export type ReviewDecision =
  | 'submit'
  | 'reviewed'
  | 'confirmed'
  | 'false_positive'
  | 'accepted'
  | 'reopen'
  | 'return_active'
  | 'rollback';
export type ReviewState = 'pending' | 'reviewed' | 'confirmed' | 'false_positive' | 'accepted' | 'reopened';
export type FindingStatus = 'open' | 'reopened' | 'manual_review' | 'verified_resolved';
export interface ReviewEvent {
  id: string;
  at: Date;
  actor: string;
  decision: ReviewDecision;
  from: FindingStatus;
  to: FindingStatus;
  previousReviewState?: ReviewState;
  reviewState: ReviewState;
  comment: string;
}
export interface ReviewableFinding {
  status: FindingStatus;
  reviewState?: ReviewState;
  reviewHistory?: ReviewEvent[];
}
export const reviewDecisions: ReviewDecision[] = [
  'submit',
  'reviewed',
  'confirmed',
  'false_positive',
  'accepted',
  'reopen',
  'return_active',
  'rollback',
];
export function reviewTransition(
  finding: ReviewableFinding,
  decision: ReviewDecision,
  comment: string,
): { status: FindingStatus; reviewState: ReviewState } {
  const note = comment.trim();
  if (note.length > 2000) throw new Error('Review comment must be 2000 characters or fewer');
  if (
    ['false_positive', 'accepted', 'reopen', 'return_active', 'rollback'].includes(decision) &&
    note.length < 3
  )
    throw new Error('A reason is required for this review decision');
  if (decision === 'submit') {
    if (!['open', 'reopened'].includes(finding.status))
      throw new Error('Only active findings can enter Manual Review');
    return { status: 'manual_review', reviewState: 'pending' };
  }
  if (decision === 'rollback') {
    if (finding.status === 'verified_resolved')
      throw new Error('Verified resolved findings cannot be rolled back through Manual Review');
    const previous = finding.reviewHistory?.at(-1);
    if (!previous) throw new Error('No previous review decision to roll back');
    return { status: previous.from, reviewState: previous.previousReviewState || 'reopened' };
  }
  if (finding.status !== 'manual_review')
    throw new Error('Finding must be in Manual Review before making this decision');
  if (
    finding.reviewState &&
    !['pending', 'reopened'].includes(finding.reviewState) &&
    finding.reviewState !== decision &&
    note.length < 3
  )
    throw new Error('A reason is required when overriding a previous review decision');
  if (decision === 'reopen' || decision === 'return_active')
    return { status: 'reopened', reviewState: 'reopened' };
  if (finding.reviewState === decision) throw new Error('Finding already has this review decision');
  return { status: 'manual_review', reviewState: decision };
}
