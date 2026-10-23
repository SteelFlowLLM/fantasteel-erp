import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FullScreenState } from '@/components/StateView';
import { LoginScreen } from '@/features/login/LoginScreen';

export const metadata: Metadata = { title: '로그인' };

export default function LoginPage() {
  return (
    <Suspense fallback={<FullScreenState kind="loading" />}>
      <LoginScreen />
    </Suspense>
  );
}
