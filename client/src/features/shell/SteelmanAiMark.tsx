// 철강맨AI 표시: AI 어시스턴트를 화면 도우미 펫 철강맨과 같은 얼굴(로고 도트)로 보여 한 캐릭터로 느끼게 한다.
// 도트는 정수 배율에서만 칸이 고르게 보여서 로고를 1배(33×24px) 그대로 쓰고, framed면 펫 대화창 아바타처럼 연한 주황 칸에 넣는다.
// framed 크기: md = 패널 머리·답 아바타, sm = 메신저 멤버 줄·AI 답처럼 줄 높이가 낮은 곳.
import { cn } from '@/lib/cn';
import { Logo } from '@/features/shell/Logo';

export function SteelmanAiMark({ framed = false, size = 'md', className }: { framed?: boolean; size?: 'sm' | 'md'; className?: string }) {
  if (!framed) {
    return (
      <span aria-hidden="true" className={cn('inline-flex flex-none', className)}>
        <Logo />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex flex-none items-center justify-center bg-steelman-soft', size === 'sm' ? 'h-7 w-9 rounded-md' : 'h-9 w-10 rounded-md', className)}
    >
      <Logo />
    </span>
  );
}
