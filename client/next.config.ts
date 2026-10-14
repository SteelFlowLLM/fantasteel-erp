import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev가 AI 에이전트를 감지하면 client/에 AGENTS.md·CLAUDE.md를 자동으로 만든다. 저장소 규칙 파일이 늘지 않게 끈다.
  agentRules: false,
  // 개발 모드의 오른쪽 아래 N 버튼이 펫 안내 말풍선·표 끝·버튼 위에 겹쳤다. 숨겨도 컴파일·실행 오류 화면은 그대로 뜬다 (Next.js devIndicators 문서)
  devIndicators: false,
};

export default nextConfig;
