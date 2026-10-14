# FantaSteel ERP — v2

철강 제조 ERP의 **1등급(P1) 기능**을 B안 화면으로 다시 만든 버전입니다. 범위와 결정은 [SPEC.md](SPEC.md), 기준 문서는 노션 설계 문서(스냅샷: [docs/notion/](docs/notion/))입니다.

지금 저장소에는 두 가지가 같이 있습니다.

- **새 화면** `client/` — Next.js(App Router) + TypeScript + Tailwind + TanStack Query. 모든 화면이 **실제 서버(`server/`)를 부릅니다**. 화면 재작업 브랜치(`feature/screen-rework`)의 결과물이고, 6개 설계 문서·ERD·공통 코드 정의서를 기준으로 다시 맞췄습니다.
- **서버** `server/` · **공통코드** `shared/` — NestJS + Prisma 7 + PostgreSQL. 설계 문서와 ERD(`docs/erd/`)를 기준으로 공통 기반·스키마·시드를 세팅했고, 모듈별 업무 로직은 팀원이 채웁니다([docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md), [docs/backend/](docs/backend/README.md)).
- P2(AI)·EX 기능은 화면만 있고 "준비 중"으로 표시됩니다. AI·LLM 호출은 없습니다.

## 화면 실행

필요: Node.js 22.18 이상. 명령은 모두 이 폴더(저장소 맨 위)에서 실행합니다.

```bash
npm install
npm run dev        # DB(54322) · shared · 서버(8787) · 화면(5173)
```

브라우저에서 http://localhost:5173 을 엽니다(포트는 `client/package.json`의 `dev` 스크립트 `next dev -p 5173`).

- 처음 열면 **로그인** 화면(`/login`)이 나옵니다. 시드 사원번호(`docs/backend/seed.md`)와 비밀번호 `fantasteel`로 들어갑니다.
- 화면 데이터는 서버 DB에 있습니다. 처음 상태로 되돌리려면 `npm run db:reset`, 화면에 볼 거래 데이터가 필요하면 그 뒤 `npm run seed:demo -w @fantasteel/server`.
- `npm install`은 설치 뒤 shared 빌드와 Prisma Client 생성도 자동으로 합니다.

### 점검·빌드

```bash
npm run typecheck -w @fantasteel/client
```

```bash
npm run test -w @fantasteel/client
```

```bash
npm run build -w @fantasteel/client
```

화면 테스트는 Vitest이고 서버·DB 없이 돌아갑니다. api 함수는 가짜 서버 응답(`useFakeServer`)으로, 화면 그리기는 고정 데이터로 시험합니다. 시연 시나리오(업무 프로세스 14.1)의 핵심 흐름은 서버 DB 테스트(`server/src/modules/sales-order/order-flow.spec.ts`)가 수주부터 출고·밀시트·추적·Message → ERP까지 잇고, 단계별 규칙(14.2·14.3)은 각 서버 모듈 테스트가 확인합니다. 빌드한 결과를 띄우려면 `npm run start -w @fantasteel/client`(같은 5173 포트).

### 화면 폴더 구조 (`client/src/`)

| 폴더 | 내용 |
|---|---|
| `app/` | Next.js 경로. `app/(main)/<주소>/page.tsx`가 화면 진입점, `app/login/`이 로그인 |
| `features/<영역>/` | 영역별 화면과 부품 (sales, production, quality, purchasing, shipment, inventory, lotTrace, businessEvents, tasks, messenger, dashboard, admin, masterData, inspectionStandards, actionDrafts, millSheets, shell …) |
| `components/` | 공용 화면 부품 (Button, Table, Modal, Badge, QueryBoundary, StateView, ComingSoon …) |
| `api/` | 화면이 데이터를 읽고 쓰는 유일한 길. `<영역>.ts`(화면 모양) → `server/<영역>.ts`(서버 어댑터) → `http.ts`(서버 호출) |
| `hooks/` | api 함수를 감싼 커스텀 훅 (TanStack Query) |
| `codes/` | **공통 코드**(공통 코드 정의서의 값·표시명), 업무 프로세스 9.3 오류 코드, 업무 번호·LOT 번호 채번 규칙(`numbering.ts`) |
| `lib/` | 순수 계산 함수 (이론중량, FIFO, MRP, 검사 판정, 소수 계산 …) |
| `stores/` | Zustand — 로그인 사원·토스트·셸 UI 상태만 |
| `styles/`, `test/` | 전역 스타일, 테스트 준비 |

### 문서

| 문서 | 내용 |
|---|---|
| [SPEC.md](SPEC.md) | 범위, 확정 사항, 임시 결정(검토 필요) |
| [docs/CLIENT-GUIDE.md](docs/CLIENT-GUIDE.md) | 새 화면 작업 규칙·구조·시드 |
| [docs/rework/PLAN.md](docs/rework/PLAN.md) | 화면 재작업 계획과 결정 |
| [docs/rework/areas/README.md](docs/rework/areas/README.md) | 영역별 노트 색인 |
| [docs/rework/seed-assumptions.md](docs/rework/seed-assumptions.md) | 시드 값과 6개 문서에 없어 정한 가정값 전체 |
| [docs/notion/](docs/notion/) | 설계 문서 01~09 (기획안·요구사항·용어 사전·업무 프로세스·코드 컨벤션·공통 코드·KS 규격·API 명세서·역할·권한). 내용은 고치지 않습니다 |
| [docs/erd/](docs/erd/) | ERD (DBML). 서버 스키마의 기준 |
| [docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md) · [docs/backend/](docs/backend/README.md) | 서버 실행·규칙, 모듈별 작업 안내, 세팅 때 정한 값 |
| [docs/GIT-GUIDE.md](docs/GIT-GUIDE.md) | Git 흐름(`feature` → `develop` → `main`), PR이 쌓였을 때·다른 PR이 머지됐을 때 할 일, 예전 작업 옮기기 |
| [CLAUDE.template.md](CLAUDE.template.md) | Claude Code 작업 규칙 초안. `npm install` 때 각자의 `CLAUDE.md`(git 제외)로 복사된다 |

## 서버와 DB

명령은 모두 저장소 맨 위에서 실행합니다. 자세한 내용은 [docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md).

`npm run dev`는 로컬 PostgreSQL(포트 54322) · shared 빌드 · API 서버(8787) · 화면을 함께 띄웁니다. 서버를 띄우기 전에 마이그레이션을 적용하고, DB가 비어 있으면 시드를 넣고, TypedSQL 타입을 만듭니다(`server/scripts/prepare-db.mjs`). PostgreSQL·Docker 설치 없이 `embedded-postgres`로 프로젝트 폴더(`.local-db/`) 안에서 DB를 띄웁니다. `server/.env`는 다른 DB(예: Supabase)를 쓸 때만 만듭니다.

| 명령 | 하는 일 |
|---|---|
| `npm run db:reset` | 개발 DB를 지우고 스키마 + 시드(조직·권한·기준정보·검사 기준)를 넣습니다. **데이터가 모두 사라집니다** |
| `npm run migrate` | 스키마를 바꾼 뒤 마이그레이션 만들기 (스키마 담당자) |
| `npm test` | 서버 테스트. 묶음별 테스트 전용 DB(`fs_*`)를 새로 만들어 돌립니다(개발 DB는 건드리지 않음). DB가 떠 있어야 합니다 |
| `npm run typecheck` | shared·server·client 타입 검사 |

DB만 따로 띄우려면 `npm run db`. 테스트 계정은 [docs/backend/seed.md](docs/backend/seed.md) (비밀번호 `fantasteel`).

### 공용 DB(Supabase)를 쓸 때

`server/.env`의 두 값만 바꿉니다 (`server/.env.example` 참고, 자세한 규칙은 [docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md) 8장).

- `DATABASE_URL` — Transaction pooler(6543) + `?pgbouncer=true`
- `DIRECT_URL` — Session pooler(5432). Direct 주소(`db.<ref>.supabase.co`)는 IPv6 전용이라 쓰지 않습니다

접속 주소는 비공개 채널로 받고 커밋·채팅·PR에 붙이지 않습니다. 공용 DB에 마이그레이션·시드를 반영하는 일은 DB 담당자만 `npm run db:deploy -w @fantasteel/server`로 합니다 (각자 `prisma migrate deploy`·시드를 돌리지 않습니다).
첨부·밀시트 PDF는 지금 `server/storage/` 폴더에 저장합니다. Supabase Storage로 옮기려면 `server/src/common/storage/storage.service.ts`만 바꾸면 됩니다.
