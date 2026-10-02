import type { Metadata } from 'next';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/dashboard') };

export default function DashboardPage() {
  return <DashboardScreen />;
}
