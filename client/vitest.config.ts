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
  },
});
