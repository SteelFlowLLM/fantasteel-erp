# FantaSteel ERP — 작업 규칙

철강 제조 AI 협업 ERP. npm workspaces 모노레포: `shared/`(공통 코드·타입), `server/`(NestJS + Prisma 7 + PostgreSQL), `client/`(Next.js). 1개월·5명 프로젝트이고 P1 기능을 먼저 완성한다.

## 이 파일

- 이 `CLAUDE.md`는 각자의 것이다. git에 올라가지 않으니(`.gitignore`) 자기 작업에 맞게 자유롭게 고친다.
- 초안은 저장소의 `CLAUDE.template.md`다. `npm install` 때 `CLAUDE.md`가 없으면 초안을 복사해 만든다. 이미 있으면 건드리지 않는다.
- 팀 공통 규칙을 바꿀 때는 `CLAUDE.template.md`를 고쳐 PR로 올리고 팀에 알린다. 각자는 바뀐 부분을 자기 `CLAUDE.md`에 옮긴다.

## 기준 문서 (읽기만 한다)

1. 설계 문서 `docs/notion/01`~`09` — 기획안, 요구사항(REQ-), 용어 사전, 업무 프로세스(BP-), 코드 컨벤션, 공통 코드, KS 규격, API 명세서(`api-spec/`), 역할·권한(`roles-permissions/`).
2. ERD `docs/erd/fantasteel_erp_p1.dbml` — 테이블·컬럼 이름과 관계의 기준. 업무 프로세스 정의서 11장과 다르면 ERD를 따른다.
3. `SPEC.md`(범위·결정), `docs/SERVER-GUIDE.md`, `docs/backend/<모듈>.md`, `docs/CLIENT-GUIDE.md`.

- **`SPEC.md`, `docs/notion/`, `docs/erd/`는 읽기만 하고 고치지 않는다** (`.claude/settings.json`에서 편집을 막아 두었다. 셸 명령으로도 고치지 않는다). 문서가 틀렸거나 모자라면 사용자에게 알린다.
- 문서에 없는 기능·이름·데이터를 임의로 추가하지 않는다. 정해진 값이 없으면 먼저 묻는다.
- 이름은 용어 사전의 변수명·DB명과 ERD 이름만 쓴다. 동의어(사용 금지) 칸의 단어는 쓰지 않는다 (`order` 단독 금지 → `salesOrder`/`purchaseOrder`).
- 코드 값과 표시명은 공통 코드 정의서 그대로 (`shared/src/codes/index.ts`는 정의서에서 생성한 파일이라 손으로 고치지 않는다: `npm run codes -w @fantasteel/shared`).

## 자주 쓰는 명령 (저장소 맨 위에서)

```bash
npm install                                  # CLAUDE.md 준비 + shared 빌드 + Prisma Client 생성
npm run dev                                  # DB(54322) · shared · 서버(8787) · 화면(5173)
npm run typecheck                            # shared · server · client
npm test                                     # 서버 테스트 (DB 필요, 테스트 전용 DB fs_* 사용)
npm run test:unit -w @fantasteel/server      # DB 없이 서버 공통 단위 테스트
npm run test -w @fantasteel/client           # 화면 테스트 (Vitest)
npm run db:reset                             # 개발 DB 초기화 (데이터 모두 삭제)
```

테스트 계정: 비밀번호 `fantasteel`, 사원번호는 `docs/backend/seed.md`.

## 서버 (`server/`)

작업 전에 `docs/SERVER-GUIDE.md`와 자기 모듈의 `docs/backend/<모듈>.md`를 읽는다.

- 레이어: controller(라우팅·DTO·`@RequirePermission`) → service(업무 로직·`this.prisma.$transaction`) → repository(DB 접근만, 첫 인자 `tx`).
- 공통 기반은 `server/src/common/`에 있다: `AppException('SO-002')`, `@RequirePermission(PERMISSION.X, 'USE')`, `@CurrentUser()`, `assertDepartmentHead`, `businessEventRecorder.record(tx, …)`, `NumberingService`, `seoulToday()`, `StorageService`. 새로 만들지 말고 이것을 쓴다. 공통 기반을 바꿔야 하면 먼저 팀에 알린다.
- 작업 로그는 본 거래와 같은 트랜잭션에서 남긴다 (REQ-LOG-002 이벤트 빠짐없이).
- `$queryRaw` 인라인·`$queryRawUnsafe` 금지. 집계·잠금·조건부 UPDATE는 `server/prisma/sql/*.sql`(TypedSQL).
- 스키마(`schema.prisma`·마이그레이션)는 스키마 담당자만 바꾼다. 순서: ERD 수정 → schema → `npm run migrate`. 커밋된 마이그레이션은 고치지 않는다.
- 예약·배정·MRP·이론중량·출고 확정 로직은 단위 테스트 필수.

## 화면 (`client/`)

`docs/CLIENT-GUIDE.md`를 따른다. 지금 화면은 브라우저 안 가짜 DB(`client/src/mock/`)로 동작하고 서버와 연결되어 있지 않다. 연결은 `client/src/api/` 함수만 바꾸는 방식으로 한다.

## 코드 공통

- TypeScript strict, `any` 금지, `console.*` 금지(서버는 Nest `Logger`), 주석은 "왜"만, `TODO(이름):`.
- 톤은 Decimal(소수 3자리 문자열로 응답), 매수는 정수. 제품 톤은 저장하지 않고 매수 × 이론중량으로 계산.
- "오늘"과 채번 날짜는 Asia/Seoul.

## Git

- 흐름 `feature/{이슈번호}-{기능}` → `develop` → `main` (`docs/GIT-GUIDE.md`). 구현 브랜치는 `origin/develop`에서 만들고 PR도 `develop`으로 보낸다. `main`·`develop`에 직접 push하지 않는다.
- 커밋 `feat:`·`fix:`·`refactor:`·`docs:`·`chore:` + 한글 요약, PR은 리뷰어 1명 이상·squash 머지 (컨벤션 10장). `develop` → `main`만 merge commit.
- `.env`, `server/src/generated/`, `.local-db/`, `CLAUDE.md`는 커밋하지 않는다.
- 패키지를 설치·변경하지 않았는데 `package-lock.json`이 바뀌었으면(OS에 따라 npm이 다시 쓸 수 있다) 그 변경은 커밋하지 않는다.
- `../v1` 폴더가 있으면 참고만 하고 수정하지 않는다.
