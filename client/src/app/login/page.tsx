import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FullScreenState } from '@/components/StateView';
import { AccountPicker } from '@/features/login/AccountPicker';

export const metadata: Metadata = { title: '계정 선택' };

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenState kind="loading" />}>
      <AccountPicker />
    </Suspense>
  );
}
