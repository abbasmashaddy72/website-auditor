import { requirePageAuth } from '@/lib/auth';
import Dashboard from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  await requirePageAuth();
  const segments = (await params).section || [];
  return <Dashboard section={segments[0] || 'dashboard'} />;
}
