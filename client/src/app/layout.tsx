import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppProviders } from '@/features/app/AppProviders';
import { FONT_SIZE_BOOT_SCRIPT } from '@/lib/fontSize';
import '@/styles/globals.css';

// B안 글꼴: IBM Plex Sans KR / IBM Plex Mono (빌드할 때 받아서 함께 배포한다)
const plexSans = IBM_Plex_Sans_KR({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-plex-sans',
});

const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: { default: 'FantaSteel ERP', template: '%s · FantaSteel ERP' },
  description: '철강 제조 AI 협업 ERP',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // 글자 크기 스크립트가 data-font-size를 먼저 달아서 서버 HTML과 달라진다
    <html lang="ko" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOT_SCRIPT }} />
      </head>
      {/* 브라우저 확장 프로그램(예: Grammarly)이 hydration 전에 body에 속성을 달아 경고가 난다. body 자기 속성만 무시하고 안쪽은 그대로 검사한다 */}
      <body suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
