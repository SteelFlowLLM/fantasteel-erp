import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // api 함수 테스트: 응답 지연을 없애고, 테스트마다 가짜 DB를 시드로 되돌린다
    setupFiles: ['./src/test/setup.ts'],
    // 시나리오(demo141·142)·접근성 정적 점검은 단독 4~5초라, 전체 실행 때 다른 파일과 같이 돌면 기본 5초를 넘겨 실패하기도 한다
    testTimeout: 20_000,
  },
});
