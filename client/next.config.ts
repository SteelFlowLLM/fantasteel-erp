import type { NextConfig } from 'next';

/**
 * 화면 서버(Next)가 API·실시간 연결을 넘겨줄 ERP 서버 주소. 브라우저는 늘 화면과 같은 주소의 /api/v1로 부른다:
 * 다른 PC에서 http://<IP>:5173으로 들어와도 그 PC의 localhost가 아니라 이 서버로 간다 (이슈 #440).
 */
const apiBaseUrl = new URL((process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787/api/v1').replace(/\/$/, ''));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev가 AI 에이전트를 감지하면 client/에 AGENTS.md·CLAUDE.md를 자동으로 만든다. 저장소 규칙 파일이 늘지 않게 끈다.
  agentRules: false,
  // 개발 모드의 오른쪽 아래 N 버튼이 펫 안내 말풍선·표 끝·버튼 위에 겹쳤다. 숨겨도 컴파일·실행 오류 화면은 그대로 뜬다 (Next.js devIndicators 문서)
  devIndicators: false,
  // 다른 PC가 사내 IP로 들어올 때 개발 모드 자원(HMR 등)을 막지 않는다. '*'는 IP 한 마디에 맞는다
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  // 서버 주소 끝의 '/'를 떼는 리다이렉트를 끈다: socket.io 주소(/socket.io/?EIO=…)가 리다이렉트되면 실시간 연결이 붙지 않는다
  skipTrailingSlashRedirect: true,
  experimental: {
    // Next 프록시는 기본으로 응답 없이 30초가 지나면 끊는다. 철강맨AI 답·심층 조사·회의록 분석은 그보다 오래 말없이 일할 수 있다
    proxyTimeout: 30 * 60_000,
    // 기본 10MB를 넘는 본문은 잘린다. 회의 녹음 올리기 상한(MEETING_AUDIO_MAX_BYTES 500MiB)에 multipart 머리 여유를 더한다
    proxyClientMaxBodySize: '510mb',
  },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiBaseUrl.href}/:path*` },
      // 메신저 실시간 연결. socket.io는 /socket.io/?EIO=… 로 붙고 끝의 '/'가 없으면 404라, 빈 경로도 '/'를 붙여 넘긴다
      { source: '/socket.io', destination: `${apiBaseUrl.origin}/socket.io/` },
      { source: '/socket.io/:path+', destination: `${apiBaseUrl.origin}/socket.io/:path+` },
    ];
  },
};

export default nextConfig;
