import type { Metadata } from 'next';
import { EmployeeScreen } from '@/features/admin/components/EmployeeScreen';
import { pageTitle } from '@/features/shell/routeTitles';

export const metadata: Metadata = { title: pageTitle('/admin/employees') };

export default function EmployeePage() {
  return <EmployeeScreen />;
}
