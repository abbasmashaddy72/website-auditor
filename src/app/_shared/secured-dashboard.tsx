import { requirePageAuth } from '@/lib/auth';
import Dashboard from '@/components/dashboard';

/** Each workspace route owns its page entry point; Dashboard still shares loaded state. */
export async function SecuredDashboard({ section }: { section: string }) {
  await requirePageAuth();
  return <Dashboard section={section} />;
}
