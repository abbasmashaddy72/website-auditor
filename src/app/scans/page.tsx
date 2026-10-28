import { SecuredDashboard } from '../_shared/secured-dashboard';
export const dynamic = 'force-dynamic';
export default function ScansPage() {
  return <SecuredDashboard section="scans" />;
}
