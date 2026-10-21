/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // 실제 DB·HTTP를 쓰는 테스트는 PC가 바쁘면(화면 테스트·빌드를 함께 돌릴 때) 기본 5초를 넘겨 가끔 실패한다. 화면 테스트(vitest.config.ts 20초)와 맞춘다
  testTimeout: 20_000,
  // 개발 DB를 지우지 않게 fs_* 시험 DB가 아니면 막는다 (이슈 #447)
  setupFiles: ['<rootDir>/../jest.db-guard.cjs'],
};
