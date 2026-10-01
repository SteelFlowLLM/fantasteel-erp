# 셸·공통 컴포넌트 (shell)

## 검토 반영

- 2026-10-02, 브랜치 `feature/screen-rework` 기준.
- **준비 중 안내 띠 조사** — `client/src/components/ComingSoon.tsx`의 `ComingSoonArea`가 제목 뒤에 `은(는)`을 그대로 붙이던 것을 `lib/josa.ts`의 `withEunNeun`으로 바꿨다(근거: `docs/rework/areas/cross-cutting.md` 2장 "안내 문구의 조사는 `lib/josa.ts`로 받침에 맞춘다").
  - 화면 문구: "AI Factory Agent는 2등급(AI) 기능이라 …", "Voice2ERP 회의록은 …", "과거 사례 검색은 추가 기능이라 …".
  - 굵은 글씨는 제목과 조사를 함께 감싼다(`<b>AI Factory Agent는</b>`).
  - 테스트: `client/src/components/ComingSoon.test.ts`(정적 렌더 결과로 조사 확인 2개).
- **단계 자리 표시 삭제** — `client/src/components/StagePlaceholder.tsx`(`StagePlaceholder`·`REWORK_STAGE_NAME`·`ReworkStage`)를 지웠다. 단계 병합 뒤 어느 화면도 쓰지 않았고, 화면에 작업 계획 단계 문구("…단계에서 만들어요")를 내보내는 코드였다. 끝나지 않은 P2·EX 화면은 `ComingSoonArea`를 쓴다.
- 공유 파일 변경: 없음(두 파일 모두 이 영역 소유).
- 확인: `npm run typecheck -w @fantasteel/client` 0 오류, `npm run test -w @fantasteel/client` 75개 파일 544개 통과.
