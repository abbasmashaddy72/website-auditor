import { SecuredDashboard } from '../_shared/secured-dashboard';
export const dynamic = 'force-dynamic';
export default function ManualReviewPage() {
  return <SecuredDashboard section="manual-review" />;
}
