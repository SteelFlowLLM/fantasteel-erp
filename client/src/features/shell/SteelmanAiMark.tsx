// 철강맨AI 표시: AI 어시스턴트를 화면 도우미 펫 철강맨과 같은 얼굴(로고 도트)로 보여 한 캐릭터로 느끼게 한다.
// 도트는 정수 배율에서만 칸이 고르게 보여서 로고를 1배(33×24px) 그대로 쓰고, framed면 펫 대화창 아바타처럼 연한 주황 칸에 넣는다.
import { cn } from '@/lib/cn';
import { Logo } from '@/features/shell/Logo';

export function SteelmanAiMark({ framed = false, className }: { framed?: boolean; className?: string }) {
  if (!framed) {
    return (
      <span aria-hidden="true" className={cn('inline-flex flex-none', className)}>
        <Logo />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={cn('inline-flex h-9 w-10 flex-none items-center justify-center rounded-md bg-steelman-soft', className)}>
      <Logo />
    </span>
  );
}
