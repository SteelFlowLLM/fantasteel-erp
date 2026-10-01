import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // next dev가 AI 에이전트를 감지하면 client/에 AGENTS.md·CLAUDE.md를 자동으로 만든다. 저장소 규칙 파일이 늘지 않게 끈다.
  agentRules: false,
};

export default nextConfig;
