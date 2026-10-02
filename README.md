# FantaSteel ERP — v2

철강 제조 ERP의 **1등급(P1) 기능**을 B안 화면으로 다시 만든 버전입니다. 범위와 결정은 [SPEC.md](SPEC.md), 기준 문서는 노션 설계 문서(스냅샷: [docs/notion/](docs/notion/))입니다.

지금 저장소에는 두 가지가 같이 있습니다.

- **새 화면** `client/` — Next.js(App Router) + TypeScript + Tailwind + TanStack Query. **서버·DB 없이 브라우저 안의 가짜 DB(mock)만으로 동작하는 화면 전용 클라이언트**입니다. 화면 재작업 브랜치(`feature/screen-rework`)의 결과물이고, 6개 설계 문서·ERD·공통 코드 정의서를 기준으로 다시 맞췄습니다.
- **서버** `server/` · **공통코드** `shared/` — NestJS + Prisma 7 + PostgreSQL. 설계 문서와 ERD(`docs/erd/`)를 기준으로 공통 기반·스키마·시드를 세팅했고, 모듈별 업무 로직은 팀원이 채웁니다([docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md), [docs/backend/](docs/backend/README.md)). 새 화면은 아직 서버를 부르지 않습니다.
- P2(AI)·EX 기능은 화면만 있고 "준비 중"으로 표시됩니다. AI·LLM 호출은 없습니다.

## 화면 실행 (서버·DB 필요 없음)

필요: Node.js 22.18 이상. 명령은 모두 이 폴더(저장소 맨 위)에서 실행합니다.

```bash
npm install
npm run dev -w @fantasteel/client
```

브라우저에서 http://localhost:5173 을 엽니다(포트는 `client/package.json`의 `dev` 스크립트 `next dev -p 5173`).

- 처음 열면 **계정 선택** 화면(`/login`)이 나옵니다. 사원 계정을 누르면 바로 들어갑니다. 사원번호·비밀번호를 입력하는 로그인 화면은 **일부러 미뤄 두었습니다**(SPEC 5장 결정 1). 계정은 탭마다 따로 기억합니다(`sessionStorage`).
- 데이터는 이 브라우저의 `localStorage`에 저장되고, 같은 브라우저의 다른 탭에도 바로 반영됩니다(`BroadcastChannel`). 서버가 없으니 다른 PC와는 공유되지 않습니다.
- 데이터를 처음 상태로 되돌리려면 화면 오른쪽 위 사용자 메뉴에서 **'시드로 초기화'**를 누릅니다.
- `npm install`은 설치 뒤 shared 빌드와 Prisma Client 생성도 자동으로 합니다(서버용 단계라 화면에는 쓰이지 않습니다).
- 루트의 `npm run dev`는 예전처럼 DB·shared·서버·화면을 함께 띄웁니다. 새 화면만 보려면 위의 client 전용 명령이면 충분합니다.

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

테스트는 Vitest이고 서버·DB 없이 가짜 DB 위에서 돌아갑니다. 시연 시나리오(업무 프로세스 14.1·14.2)와 14.3 필수 검증은 `client/src/api/scenario/`의 테스트가 화면 api 함수로 끝까지 돌립니다. 빌드한 결과를 띄우려면 `npm run start -w @fantasteel/client`(같은 5173 포트).

### 화면 폴더 구조 (`client/src/`)

| 폴더 | 내용 |
|---|---|
| `app/` | Next.js 경로. `app/(main)/<주소>/page.tsx`가 화면 진입점, `app/login/`이 계정 선택 |
| `features/<영역>/` | 영역별 화면과 부품 (sales, production, quality, purchasing, shipment, inventory, lotTrace, businessEvents, tasks, messenger, dashboard, admin, masterData, inspectionStandards, actionDrafts, millSheets, shell …) |
| `components/` | 공용 화면 부품 (Button, Table, Modal, Badge, QueryBoundary, StateView, ComingSoon …) |
| `api/` | 화면이 데이터를 읽고 쓰는 유일한 길. 권한 확인(COM-002)·검증·작업 로그를 거쳐 가짜 DB를 바꾼다 |
| `hooks/` | api 함수를 감싼 커스텀 훅 (TanStack Query) |
| `codes/` | **공통 코드**(공통 코드 정의서의 값·표시명), 업무 프로세스 9.3 오류 코드, 업무 번호·LOT 번호 채번 규칙(`numbering.ts`) |
| `mock/` | **브라우저 안 가짜 DB**: `schema.ts`(테이블), `store.ts`·`db.ts`(저장·탭 동기화), `seed.ts`(조직·기준정보 시드), `seeds/`(거래·협업 시드), `services/`(업무 규칙 서비스), `businessEvents.ts`(작업 로그 기록) |
| `lib/` | 순수 계산 함수 (이론중량, FIFO, MRP, 검사 판정, 소수 계산 …) |
| `stores/` | Zustand — 계정·토스트·셸 UI 상태만 |
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

### Supabase로 옮길 때

`server/.env`의 두 값만 바꿉니다 (`server/.env.example` 참고).

- `DATABASE_URL` — Transaction pooler(6543) + `?pgbouncer=true`
- `DIRECT_URL` — Direct 연결 또는 Session pooler(5432)

그다음 `cd server && npx prisma migrate deploy && npx tsx prisma/seed.ts`.
첨부·밀시트 PDF는 지금 `server/storage/` 폴더에 저장합니다. Supabase Storage로 옮기려면 `server/src/common/storage/storage.service.ts`만 바꾸면 됩니다.
