# 서버 작업 안내

서버(`server/`)는 NestJS + Prisma 7 + PostgreSQL이다. 공통 기반(인증·권한·오류·응답·채번·작업 로그)과 데이터 구조(ERD 42개 테이블)는 만들어 두었고, 각 모듈의 업무 로직은 담당자가 채운다. 모듈별 할 일은 [docs/backend/](backend/README.md)에 있다.

## 1. 기준 (우선순위 순)

1. 설계 문서 `docs/notion/01`~`09` (기획안, 요구사항, 용어 사전, 업무 프로세스, 코드 컨벤션, 공통 코드, KS 규격, API 명세서, 역할·권한). **내용은 고치지 않는다.**
2. ERD `docs/erd/fantasteel_erp_p1.dbml`. 업무 프로세스 정의서 11장(구현 제안)과 다르면 ERD를 따른다.
3. 이 문서와 `docs/backend/` — 문서에 없어 세팅 때 정한 값.

## 2. 실행

필요: Node.js 22.18 이상. 명령은 저장소 맨 위에서 실행한다.

```bash
npm install          # shared 빌드 + Prisma Client 생성까지 자동
npm run dev          # 로컬 DB(54322) · shared · 서버(8787) · 화면(5173)
```

- `npm run dev`는 서버를 띄우기 전에 `server/scripts/prepare-db.mjs`로 마이그레이션 적용 → 빈 DB면 시드 → TypedSQL 생성을 한다. 마이그레이션·시드는 로컬 DB(54322)일 때만 하고, 공용 DB(Supabase)면 건너뛴다(8장).
- 로컬 DB는 `embedded-postgres`로 프로젝트 폴더(`.local-db/`) 안에서 뜬다. Docker가 필요 없다. DB만 띄우려면 `npm run db`.
- 서버만: `npm run dev:server` (DB가 떠 있어야 한다).
- 테스트 계정: 시드 사원 15명, 비밀번호 모두 `fantasteel`. 사원번호는 [backend/seed.md](backend/seed.md).
- 로그인: `POST /api/v1/auth/login {"employeeNo":"2103003","password":"fantasteel"}` → `access_token` httpOnly 쿠키. 이후 요청은 쿠키를 함께 보낸다(curl은 `-c`/`-b`).

| 명령 | 하는 일 |
|---|---|
| `npm run db:reset` | 개발 DB(`fantasteel`)를 지우고 스키마 + 시드를 다시 넣는다. **데이터가 모두 사라진다** |
| `npm run migrate` | 스키마를 바꾼 뒤 마이그레이션 만들기 (스키마 담당자만, 7장). 로컬 DB에서만 실행된다 |
| `npm run seed` | 시드 다시 넣기 (반복 실행해도 결과 같음). 로컬 DB에서만 실행된다 |
| `npm run db:deploy -w @fantasteel/server` | 공용 DB에 마이그레이션 반영 (DB 담당자만, 최신 develop에서만, 8장). 처음 한 번은 `-- --seed`로 빈 DB에 시드까지 |
| `npm test` | 서버 테스트. 묶음마다 테스트 전용 DB(`fs_*`)를 새로 만들어 돌린다. DB가 떠 있어야 한다 |
| `npm run test:unit -w @fantasteel/server` | DB 없이 공통 단위 테스트만 |
| `npm run typecheck` | shared·server·client 타입 검사 |
| `npm run check-orphans -w @fantasteel/server` | 고아 데이터 점검 (시드 후·PR 전, 컨벤션 7-2) |
| `npm run generate:sql -w @fantasteel/server` | `prisma/sql/*.sql` TypedSQL 타입 생성 (DB 필요) |
| `npm run codes -w @fantasteel/shared` | 공통 코드 정의서 2장 → `shared/src/codes/index.ts` 다시 만들기 |

## 3. 폴더

```
shared/src/
  codes/index.ts      공통 코드 (정의서 2장에서 생성, 손으로 고치지 않음)
  errors.ts           오류 코드 (업무 프로세스 정의서 9.3)
  api.ts              응답 포맷·AuthUser·PageResult. 모듈 응답 타입은 이 옆에 추가
  weight.ts           이론중량·톤 계산
server/
  prisma/schema.prisma        ERD 그대로 (relationMode = "prisma", DB FK 없음)
  prisma/migrations/          초기 마이그레이션 + ERD Note의 CHECK·부분 unique SQL
  prisma/sql/                 TypedSQL (집계·잠금·3개 이상 JOIN)
  prisma/seed.ts              조직·권한·기준정보·검사 기준 (거래 데이터 없음)
  scripts/                    prepare-db · reset-db · test · check-orphans
  src/main.ts                 /api/v1 prefix · CORS(쿠키) · ValidationPipe
  src/app.module.ts           모듈 등록 · 전역 가드·인터셉터·필터
  src/prisma/                 PrismaService (Tx 타입)
  src/common/                 공통 기반 (4장)
  src/modules/<모듈>/          module · controller · service · repository · dto/
```

## 4. 공통 기반 (`server/src/common/`)

| 무엇 | 파일 | 쓰는 법 |
|---|---|---|
| 오류 | `errors/app.exception.ts` | `throw new AppException('SO-002')` · 문구를 바꿀 때 `new AppException('INV-001', '가용 매수가 6매예요')`. 실패 응답은 전역 필터가 `{ success: false, error: { code, message } }`로 만든다 |
| 응답 | `http/response.interceptor.ts` | 값을 return하면 `{ success: true, data }`. 응답 모양은 모듈의 매퍼 함수(`toSalesOrderResponse`)가 정한다 |
| 인증·권한 | `auth/` | 모든 API는 로그인 필요(전역 가드). `@Public()`은 로그인만. `@RequirePermission(PERMISSION.SALES_ORDER_CREATE, 'USE')` (조회는 `'VIEW'`). 로그인 사원은 `@CurrentUser() user: AuthUser` |
| 부서장 확인 | `auth/department-head.ts` | 구매요청 승인·반려: `assertDepartmentHead(user, requester.departmentId)` (권한 코드 아님, REQ-AUTH-004) |
| 작업 로그 | `business-event/business-event.recorder.ts` | 본 거래와 같은 tx에서 `businessEventRecorder.record(tx, { type, actor: user 또는 'SYSTEM', target: { table, id }, salesOrderId, lotIds, before, after, reason })` |
| 채번 | `numbering/` | `numbering.nextDocumentNumber(tx, 'SALES_ORDER')` · `nextLotNumber(tx, 'HEAT', 'BOF1')` · `nextMillSheetNumber(tx, id, no)` · 슬래브·코일은 `formatSlabNumber`·`formatCoilNumber` |
| 날짜 | `time/seoul-date.ts` | `seoulToday()`, `seoulDateOnly()` — "오늘"·채번 날짜는 Asia/Seoul |
| 파일 | `storage/storage.service.ts` | `save(folder, fileName, buffer)` → 경로, `read(path)`. 지금은 로컬 폴더, Supabase Storage로 옮길 때 이 파일만 바꾼다 |
| 메신저 소켓 인증 | `auth/auth-token.service.ts` | handshake에서 `verifyCookieHeader(socket.handshake.headers.cookie)` |

`CommonModule`과 `PrismaModule`은 전역이라 모듈에서 import 없이 생성자로 받는다.

## 5. 코드 규칙 (코드 컨벤션 요약 — 전문은 `docs/notion/05-코드-컨벤션.md`)

- **레이어:** controller(라우팅·DTO·권한, 업무 로직 금지) → service(업무 로직·트랜잭션·데이터에 따른 권한) → repository(DB 접근만, 첫 인자 `tx`).
- **트랜잭션:** service에서 `this.prisma.$transaction(async (tx) => { ... })`. 다른 모듈 service를 같은 트랜잭션에서 부를 때는 그 모듈이 service를 export하고 `tx`를 넘긴다.
- **SQL:** `$queryRaw` 인라인·`$queryRawUnsafe` 금지. 집계·잠금·조건부 UPDATE는 `prisma/sql/*.sql`(TypedSQL) → `tx.$queryRawTyped(...)`. 삭제·FK 변경은 Prisma Client로만.
- **경로:** controller는 `/api/v1`을 빼고 쓴다(main.ts가 붙임). 리소스가 여러 개라 `@Controller()` + 메서드마다 전체 경로(`@Get('sales-orders/:id')`). 상태 변경은 `POST /:id/동작`.
- **DTO:** class-validator. 오류 문구는 한국어로 (`@IsInt({ message: '...' })`). 상태값 검증은 `@IsIn(Object.values(RESERVATION_STATUS))`.
- **값:** 상태값은 `@fantasteel/shared` 상수만. 톤은 `Prisma.Decimal`(소수 3자리 문자열로 응답), 매수는 Int. 제품 톤은 저장하지 않고 `calcWeightTon(qty, theoreticalWeightTon)`.
- **이름:** 용어 사전 변수명·DB명과 ERD 이름. 동의어(사용 금지) 칸의 단어는 쓰지 않는다(`order` 단독 금지 → `salesOrder`/`purchaseOrder`).
- **기타:** `any` 금지, `console.*` 금지(Nest `Logger`), 주석은 "왜"만, `TODO(이름):`.

## 6. 끝낼 때 (PR 전)

1. `npm run typecheck` 통과, `npm test -- <내 모듈>` 통과. 예약·배정·MRP·이론중량·출고 확정 로직은 단위 테스트 필수 (컨벤션 11장).
2. 서버를 띄워 정상 흐름과 주요 오류를 실제로 호출해 본다.
3. `npm run check-orphans -w @fantasteel/server` 통과.
4. 문서에 없는 이름·값을 새로 정했으면 PR 설명에 적고, 필요하면 설계 문서 수정을 요청한다 (문서는 직접 고치지 않는다).
5. 브랜치 `feature/{이슈번호}-{기능}`(`origin/develop`에서 만들고 PR은 `develop`으로, [GIT-GUIDE.md](GIT-GUIDE.md)), 커밋 `feat:`·`fix:`… + 한글 요약, PR 템플릿(작업 내용·관련 REQ ID·테스트 방법) (컨벤션 10장).

## 7. 스키마를 바꿀 때 (컨벤션 7-3)

- 스키마 담당자 1명이 `schema.prisma`와 마이그레이션을 관리한다. 다른 사람은 이슈·PR 설명으로 요청한다.
- 순서: ERD(`docs/erd/`) 수정 → `schema.prisma` 반영 → `npm run migrate` (`prisma migrate dev`) → 커밋. 커밋된 마이그레이션 파일은 고치지 않는다.
- CHECK·부분 unique는 Prisma 스키마로 표현되지 않아 마이그레이션 SQL에 직접 쓴다 (초기 마이그레이션 맨 아래 참고). Prisma는 이것을 지우지 않는다.

## 8. Supabase로 옮길 때

`server/.env`의 두 값만 바꾼다 (`server/.env.example` 참고). `DATABASE_URL`은 Transaction pooler(6543) + `?pgbouncer=true`, `DIRECT_URL`은 Direct 또는 Session pooler(5432).

- 공용 DB를 가리키면 `npm run dev`는 마이그레이션·시드를 건너뛰고, `migrate`·`migrate:deploy`·`seed`는 실행하지 않는다. 누가 머지 전 브랜치로 dev를 켜도 공용 DB가 바뀌지 않게 하려는 것이다.
- 공용 DB 반영은 DB 담당자가 최신 develop에서 `npm run db:deploy -w @fantasteel/server`로만 한다(처음 한 번은 `-- --seed`). develop 브랜치·고치던 파일 없음·`origin/develop`과 같음을 확인하고 대상 호스트를 보여 준 뒤 반영한다.
