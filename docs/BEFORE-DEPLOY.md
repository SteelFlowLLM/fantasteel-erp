# 배포 전에 할 일

지금은 개발·시험 단계라 일부러 미뤄 둔 것들이다. 실제 사용자에게 서버를 열기 전(AWS 공개 배포 전)에 처리한다. (2026-10-22 정리, 기준 develop 4ebaf52e)

## 1. 비밀번호 노출

**상황**
- GitHub 저장소(`SteelFlowLLM/fantasteel-erp`)가 공개(PUBLIC)다.
- 시드 공통 비밀번호는 #546에서 문서·코드에서 지웠다(`SEED_PASSWORD`는 기본값 없이 `server/.env`에서만 받는다). 하지만 예전 커밋에는 남아 있고, 사원번호는 문서에 그대로 있다.
- 시드는 이미 있는 사원의 비밀번호를 바꾸지 않는다. 새 `SEED_PASSWORD`를 정해도 운영 DB(Supabase)의 사원은 예전 비밀번호 그대로라 따로 바꿔야 한다.
- 이대로 공개 주소에 서버를 열면 누구나 관리자로 로그인할 수 있다. 로그인 실패 제한(#489)은 처음부터 맞는 비밀번호를 넣는 것은 막지 못한다.

**할 일 (공개 배포 전에 하나 이상)**
- [ ] 저장소를 비공개로 바꾼다 (GitHub Settings → General → Danger Zone).
- [ ] 새 공통 비밀번호를 정해 팀에 따로 알리고, 운영 DB 사원의 비밀번호를 그 값으로 바꾼다.
- [ ] 비밀번호 바꾸기·초기화 기능을 만든다. 첫 로그인 때 바꾸게 한다 (지금 없음, `docs/backend/organization.md` 8장).
- [ ] 로그아웃하면 토큰을 끊는다 (지금은 로그아웃해도 JWT가 12시간 유효).
- [ ] 위가 끝나기 전까지는 Tailscale 안에서만 열거나, Caddy `basic_auth`·IP 제한을 건다.

## 2. 배포 브랜치

**상황**
- `deploy/aws/README.md:36`은 `git switch main`을 배포 브랜치로 적었다.
- 하지만 main은 2026-10-02(e2fda0ac)에 멈춰 있고 develop보다 940커밋 뒤다. 모듈·마이그레이션이 크게 모자라 그대로 배포하면 지금 기능이 거의 없다.

**할 일**
- [ ] 배포 직전에 develop → main PR을 머지하고 main에서 배포한다. (또는 README를 develop 기준으로 고친다.)
- [ ] 그 커밋의 마이그레이션을 Supabase에 먼저 반영한다: `npm run db:deploy -w @fantasteel/server`.

## 3. 클라우드 LLM으로 바꿀 때

지금은 로컬 LLM(내 Mac)만 써서 미룬다. 외부 유료 LLM으로 바꾸기 전에 한다.

- [ ] 철강맨AI 패널·메신저 @AI가 LLM 출력 상한(`max_tokens`)을 넘기지 않는다 (`server/src/modules/llm/llm.client.ts`의 `maxTokens`가 선택값). 전체 시간 상한도 없다.
- [ ] 메신저 @AI 횟수 제한이 없다 (`server/src/modules/messenger/messenger.service.ts` @AI 처리).
- [ ] 사원별·하루 사용량 기록과 한도가 없다.

## 4. 정해야 할 것

- [ ] **운영 DB**: 개발 서버가 지금 팀 공용 Supabase에 붙어 있다(`server/.env`의 두 번째 `DATABASE_URL`·`DIRECT_URL`). 운영과 같은 DB를 쓰면 Notion 동기화·심층 조사 일꾼·Agent 스케줄러가 서버끼리 부딪힌다. 운영용 Supabase를 따로 두거나, 개발 서버는 로컬 DB로 돌린다.
- [ ] **채번 자리수**: 작업 로그 EV가 하루 999건, 수주 SO가 월 999건, 용선 LOT이 고로별 하루 99건을 넘으면 그 번호를 쓰는 쓰기가 모두 COM-999로 실패한다(`server/src/common/numbering/number-format.ts`). 공통 코드 정의서 9.2가 TBD다.

## 5. 운영 준비

- [ ] CI(GitHub Actions: typecheck · 서버 단위 시험 · 화면 시험)
- [ ] `/health` 확인 주소, 다운 알림
- [ ] `STORAGE_DIR`(메신저 첨부)·`storage/settings/` 백업, 로그 회전
- [ ] 서버는 한 프로세스로만 띄운다(pm2 cluster 금지). 소켓·알림·잠금 일부가 프로세스 메모리에 있다.
- [ ] LLM·음성 서버를 돌리는 Mac이 잠자기에 들지 않게 한다.
