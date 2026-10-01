# FantaSteel ERP — v2

철강 제조 ERP의 **1등급(P1) 기능**을 v1의 B안 화면으로 다시 만든 버전입니다. 범위와 결정은 [SPEC.md](SPEC.md), 기준 문서는 노션 설계 문서(스냅샷: [docs/notion/](docs/notion/))입니다.

- **서버** `server/` — NestJS + Prisma 7 + PostgreSQL (코드 컨벤션대로 module → controller → service → repository)
- **화면** `client/` — React + Vite + TanStack Query, B안 디자인
- **공통코드** `shared/` — 상태값·권한·에러 코드·이론중량 계산
- P2(AI)·EX 기능은 화면만 있고 "준비 중"으로 표시됩니다. AI·LLM 호출은 없습니다.

## 실행

필요: Node.js 22.18 이상. 클론한 뒤 이 두 줄이면 됩니다 (`.env` 없어도 됩니다).

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5173 을 엽니다. 지금은 시연용이라 로그인 입력 없이 **계정 선택** 화면에서 역할 계정을 누르면 바로 들어갑니다 (로그인은 재작업 예정).

- `npm install` — 설치 뒤 shared 빌드와 Prisma Client 생성(`prisma generate`)까지 자동으로 합니다.
- `npm run dev` — 로컬 PostgreSQL(포트 54322) · shared 빌드 · API 서버(8787) · 화면(5173)을 함께 띄웁니다. 서버를 띄우기 전에 마이그레이션을 적용하고, DB가 비어 있으면 시드를 넣습니다(`server/scripts/prepare-db.mjs`).
- PostgreSQL·Docker 설치 없이 `embedded-postgres`로 프로젝트 폴더(`.local-db/`) 안에서 DB를 띄웁니다.
- `server/.env`는 다른 DB(예: Supabase)를 쓸 때만 만듭니다. 없으면 로컬 DB 주소와 기본값을 씁니다.

같은 네트워크의 팀원은 `http://<실행한 PC의 IP>:5173` 으로 접속할 수 있습니다 (Windows 방화벽에서 5173 허용 필요).

### 데이터

| 명령 | 하는 일 |
|---|---|
| `npm run db:reset` | 개발 DB를 지우고 스키마 + 시드(조직·기준정보·초기 재고)만 넣습니다. **데이터가 모두 사라집니다** |
| `npm run demo` | 시연용 거래 데이터를 실제 API로 만듭니다 (수주 3건, 구매·입고, 검사 대기, 메신저 등). 서버가 떠 있어야 하고, 수주가 하나도 없을 때만 동작합니다 |
| `npm run migrate` | 스키마를 바꾼 뒤 마이그레이션 만들기 (Prisma Migrate) |

DB만 따로 띄우려면 `npm run db`.

### 점검

```bash
npm run typecheck
```

```bash
npm test
```

`npm test`는 서버 테스트 277건을 묶음별 전용 DB(`fs_*`)에서 돌립니다 (개발 DB는 건드리지 않습니다). DB가 떠 있어야 합니다.

인수 시나리오 14.1(수주 → 예약 → 계획 → 구매 → 생산 → 검사 → 출하 → 밀시트 → 추적)을 HTTP로 끝까지 돌려 보려면, 깨끗한 시드 DB로 서버를 하나 더 띄우고 실행합니다.

```bash
cd server && npx nest build && node scripts/reset-db.mjs fs_e2e && DATABASE_URL=postgresql://postgres:postgres@localhost:54322/fs_e2e API_PORT=8899 node dist/main.js
```

```bash
npm run e2e
```

## Supabase로 옮길 때

`server/.env`의 두 값만 바꿉니다 (`server/.env.example` 참고).

- `DATABASE_URL` — Transaction pooler(6543) + `?pgbouncer=true`
- `DIRECT_URL` — Direct 연결 또는 Session pooler(5432)

그다음 `cd server && npx prisma migrate deploy && npx tsx prisma/seed.ts`.
첨부·밀시트 PDF는 지금 `server/storage/` 폴더에 저장합니다. Supabase Storage로 옮기려면 `server/src/common/storage/storage.service.ts`만 바꾸면 됩니다.

## 문서

| 문서 | 내용 |
|---|---|
| [SPEC.md](SPEC.md) | 범위, 확정 사항(8번), 임시 결정(9번 — 검토 필요) |
| [docs/names/](docs/names/) | 용어 사전에 없어 새로 지은 이름 (검토 필요) |
| [docs/api/](docs/api/) | 모듈별 API 요청·응답 |
| [docs/SERVER-GUIDE.md](docs/SERVER-GUIDE.md) · [docs/CLIENT-GUIDE.md](docs/CLIENT-GUIDE.md) | 서버·화면 작업 규칙, v2에서 정한 업무 규칙 |
| [docs/notion/](docs/notion/) | 노션 설계 문서 스냅샷 (2026-09-30) |
