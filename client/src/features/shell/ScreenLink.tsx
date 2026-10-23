// 다른 화면으로 가는 글자 링크. 그 화면을 열 권한이 없으면 잠금 화면으로 보내지 않게 링크 없이 글자만 보인다 (역할별 메뉴 v2 3장)
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useCanOpenHref } from '@/hooks/usePermission';

type ScreenLinkProps = ComponentProps<typeof Link> & {
  href: string;
  /** 열 수 없을 때 글자에 줄 class (링크 색·밑줄은 빼고) */
  textClassName?: string;
};

export function ScreenLink({ href, textClassName, children, ...rest }: ScreenLinkProps) {
  const canOpen = useCanOpenHref();
  if (!canOpen(href)) {
    // 화면 도우미 펫이 칸을 찾는 data-pet-* 표시는 글자에도 남긴다
    const dataAttributes = Object.fromEntries(Object.entries(rest).filter(([key]) => key.startsWith('data-')));
    return (
      <span className={textClassName} {...dataAttributes}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
