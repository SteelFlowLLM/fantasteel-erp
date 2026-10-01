import type { Metadata } from 'next';
import { ButtonLink } from '@/components/Button';
import { FullScreenState } from '@/components/StateView';

export const metadata: Metadata = { title: '없는 화면' };

export default function NotFound() {
  return (
    <FullScreenState
      kind="empty"
      title="없는 화면이에요"
      text="주소를 다시 확인해 주세요."
      actions={
        <ButtonLink href="/dashboard" variant="primary">
          대시보드로
        </ButtonLink>
      }
    />
  );
}
