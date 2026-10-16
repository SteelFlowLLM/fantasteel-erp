# integration — 외부 서비스 연결 (Notion MCP)

> 근거 약어: [02] 요구사항 정의서 · [05] 코드 컨벤션 · [ERD] `docs/erd/fantasteel_erp_p1.dbml`. 🟡 = 문서에 없어 정한 값.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| 이슈 | #358 MCP 연결과 회의록 Notion 내보내기 (AI 기능 계획 1단계). 🟡 설계 문서에 없는 기능 |
| 이번 단계 | 회사 Notion 계정 하나를 원격 MCP 서버(`https://mcp.notion.com/mcp`)에 OAuth로 연결하고, 확정한 회의록을 Notion 페이지로 내보낸다 ([meeting-minutes.md](meeting-minutes.md) 'Notion으로 내보내기') |
| 다음 단계 | Google Drive. MCP가 아니라 REST API v3 + 일반 OAuth 2.0(관리자가 넣은 client id·secret, `access_type=offline`)으로 같은 테이블·암호화·토큰 저장을 쓴다 (8장) |

- **회사 계정 하나**: 관리자(`ORG_MANAGE` 사용)가 한 번 연결하면 모든 사원이 그 연결을 쓴다. 사원별 연결은 없다.
- **LLM은 Notion 도구 목록을 보지 않는다.** 서버 코드가 정한 도구(`notion-create-pages`)만 직접 부른다.

## 2. 테이블

| 구분 | 테이블 | 핵심 규칙 |
| --- | --- | --- |
| 쓰기 | `integration_connection` 🟡 | 연결 대상(`provider_key`, unique, 서버 코드 프리셋 키 — 공통 코드 아님)마다 한 행. 처음 설정·연결할 때 만든다 |
| 쓰기 | `meeting_minutes` | `notion_page_url`, `notion_exported_at` (내보내기) |

`integration_connection` 칸 (마이그레이션 `20261016024725_integration_connection`):

| 칸 | 내용 |
| --- | --- |
| `server_url` | MCP 서버 주소. MCP가 아닌 연결은 null |
| `oauth_client_information` | OAuth 클라이언트 정보 **암호문**. MCP는 동적 등록 결과, 일반 OAuth는 관리자가 넣은 client id·secret |
| `oauth_tokens` | 액세스·리프레시 토큰 **암호문** (SDK가 준 모양 그대로, `issuer` 포함) |
| `oauth_code_verifier` | PKCE code verifier **암호문**. 연결 중에만 있다 |
| `oauth_state`, `oauth_state_expires_at` | 콜백 확인값(32바이트 무작위, unique)과 만료(10분). 연결 중에만 있다 |
| `settings` jsonb | 연결별 설정. Notion: `{ parentPageId }` (32자리 소문자 16진수) |
| `connected_by_id` | 마지막으로 연결을 시작한 관리자 |
| `connected_at` | 연결 완료 시각. **토큰이 없는데 값이 있으면 다시 연결해야 한다** |
| `last_error` | 마지막 실패 이유 (500자, 비밀값 없음) |

상태(`IntegrationConnectionStatus`)는 저장하지 않고 계산한다: 토큰 있음 → `CONNECTED`, 토큰 없음 + `connected_at` 있음 → `RECONNECT_REQUIRED`, 그 밖 → `NOT_CONNECTED`.

## 3. API

| Method | Path | 이름 | 권한 |
| --- | --- | --- | --- |
| GET | `integrations` | 연결 대상 목록·상태·설정 (`IntegrationConnectionView[]`, 비밀값 없음) | 로그인한 전 역할 🟡 |
| PUT | `integrations/:providerKey/settings` | 설정 저장. Notion: `{ parentPage: 주소 또는 id \| null }` | `ORG_MANAGE` 사용 |
| POST | `integrations/:providerKey/connect` | 연결 시작 → `{ authorizationUrl }` | `ORG_MANAGE` 사용 |
| GET | `integrations/oauth/callback` | OAuth 콜백 → 화면으로 302 | **공개**(`@Public`), `state`로 확인 |
| POST | `integrations/:providerKey/disconnect` | 연결 끊기 | `ORG_MANAGE` 사용 |
| POST | `integrations/:providerKey/test` | 연결 확인: 도구 목록 (`IntegrationTestResult`, 실패도 결과로) | `ORG_MANAGE` 사용 |
| POST | `meeting-minutes/:id/notion-export` | 회의록 내보내기 ([meeting-minutes.md](meeting-minutes.md)) | 작성자 또는 `ORG_MANAGE` 사용 |

- 🟡 설정 전용 권한 코드가 없어 LLM 연결 설정처럼 `ORG_MANAGE`를 쓴다(가정).
- 🟡 목록은 로그인만 본다: 회의록 화면이 내보내기 버튼을 보일지(`status === 'CONNECTED'`, `settings.parentPageId` 있음) 정하려고 읽는다. 비밀값은 응답에 없다.
- 지금 `providerKey`는 `notion` 하나(`INTEGRATION_PROVIDER`). 모르는 키는 `INT-001`.

## 4. OAuth 흐름 (MCP 인가 규격: 발견 + 동적 클라이언트 등록 + PKCE)

공식 SDK `@modelcontextprotocol/sdk`(1.32)의 `auth()`·`StreamableHTTPClientTransport({ authProvider })`를 쓴다. `McpOAuthProvider`가 SDK의 `OAuthClientProvider`를 DB(암호화)에 붙인다.

1. 화면(관리 > 외부 연결)이 `POST integrations/notion/connect`를 부른다. 서버는 `oauth_state`(10분)와 `connected_by_id`를 적고 **옛 토큰을 지운 뒤** `auth()`를 부른다: 보호 자원 메타데이터(RFC 9728) → 인가 서버 메타데이터 → (등록 정보가 없거나 redirect URI가 바뀌었으면) 동적 등록 → code verifier 저장 → 허용 화면 주소를 응답으로 돌려준다.
2. 화면이 브라우저를 `authorizationUrl`로 옮긴다. 관리자가 Notion에서 워크스페이스·페이지 접근을 허용한다.
3. Notion이 브라우저를 `GET {SERVER_PUBLIC_URL}/integrations/oauth/callback?code&state`로 돌려보낸다. **로그인 쿠키가 없을 수 있어 공개 경로**이고, 저장한 `state`로 연결을 찾아 **한 번만** 쓴다(조건부 UPDATE로 지움). 만료·재사용·모르는 state·`error=access_denied`는 토큰을 바꾸지 않는다.
4. `auth({ authorizationCode })`로 토큰을 받아 암호화해 저장하고 code verifier를 지운다. `connected_at`을 적고 브라우저를 `{CLIENT_BASE_URL}/admin/integrations?integration=notion&result=connected`로 보낸다. 실패하면 `result=error&message=…`(그리고 `last_error`).

**호출할 때** (`McpClientService.withSession`): 부를 때마다 연결을 열고 닫는다. 액세스 토큰이 만료돼 401이 오면 SDK가 리프레시 토큰으로 갱신해 다시 보낸다. 갱신도 안 되면(`invalid_grant`·401 반복) 토큰을 지우고 `last_error`를 남겨 `RECONNECT_REQUIRED`가 되고 `INT-003`을 던진다. 백그라운드 호출은 허용 화면으로 갈 수 없으므로 SDK가 브라우저 이동을 시키면 바로 다시 연결 필요로 끝낸다(연결 중인 관리자의 code verifier도 덮어쓰지 않는다). 같은 연결 대상의 호출은 서버 안에서 한 줄로 세운다(동시 갱신으로 리프레시 토큰이 무효가 되지 않게). HTTP 요청 하나와 MCP 요청 하나의 상한은 각각 60초.

**연결 끊기**는 우리 쪽 토큰·클라이언트 정보·확인값을 지우고 설정은 남긴다. MCP에는 토큰 취소 요청이 없으므로 Notion 쪽 허용까지 없애려면 Notion의 설정 > 연결에서 지운다.

## 5. Notion에 맞춘 부분 (`notion/notion.tools.ts` 한 곳)

- 도구 이름 `notion-create-pages`. 연결할 때마다 `listTools`로 있는지 보고, 없으면 `INT-005`.
- 입력: `{ parent: { type: 'page_id', page_id }, pages: [{ properties: { title }, content }] }`. 도구 스키마에 `allow_async`가 있으면 `false`(기본이 비동기라 바로 주소를 받으려고). 스키마에 `parent`·`pages`가 없으면 `INT-005`.
- 결과: `isError`면 `INT-004`(서버 문구 300자). JSON 글·`structuredContent`에서 `url`(없으면 `id`로 `https://www.notion.so/<id>`), 그것도 없으면 글 속 Notion 주소. 못 찾으면 `INT-004`(비동기 작업 결과 포함).
- 상위 페이지 읽기(`normalizeNotionPageId`): 32자리 16진수·대시 있는 UUID, `notion.so`·`notion.site`·`notion.com` 주소의 끝 id(제목 슬러그·퍼센트 인코딩 허용), 미리보기 쿼리 `p`를 먼저 본다. 못 읽으면 `COM-004`.
- 페이지 쓰기 권한: Notion MCP는 연결한 사람의 권한으로 쓴다. 상위 페이지는 그 계정이 편집할 수 있는 페이지여야 한다.

## 6. 보안

- 토큰·클라이언트 정보·code verifier는 **AES-256-GCM**으로 암호화해 저장한다(`integration-crypto.ts`, `v1:<iv>:<tag>:<암호문>` base64, 값마다 새 12바이트 iv, 인증 태그로 위변조 감지). 키는 환경변수 `INTEGRATION_SECRET_KEY`(32바이트, base64 또는 64자리 16진수). 키가 없거나 틀리면 연결 기능만 `INT-008`로 막히고 서버는 뜬다.
- 키를 바꾸면 저장된 값을 풀 수 없어 `INT-003`(다시 연결)이 된다. 키는 커밋하지 않는다(`server/.env`).
- 비밀값은 응답·로그·`last_error`에 넣지 않는다. 로그에는 실패 문구만 남긴다(Nest `Logger`).
- 콜백은 공개지만 `state`(32바이트 무작위, 10분, 한 번)로만 연결을 찾는다. PKCE(S256)로 인가 코드를 가로채도 토큰으로 바꿀 수 없다.
- 공개 클라이언트(`token_endpoint_auth_method: none`)로 동적 등록한다. 서버가 client secret을 주면 SDK가 그것을 쓴다(암호화해 저장).

## 7. 환경변수 (`server/.env.example`)

| 변수 | 기본값 | 쓰임 |
| --- | --- | --- |
| `INTEGRATION_SECRET_KEY` | 없음(연결 기능 막힘) | 암호화 키. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SERVER_PUBLIC_URL` | `http://localhost:{API_PORT}/api/v1` | 브라우저가 서버에 닿는 주소. redirect URI = `{이 값}/integrations/oauth/callback`. 바뀌면 다음 연결 때 클라이언트를 다시 등록한다 |
| `CLIENT_BASE_URL` | `CORS_ORIGIN`의 첫 주소 → `http://localhost:5173` | 콜백 뒤 돌아갈 화면 (`/admin/integrations`) |
| `NOTION_MCP_URL` | `https://mcp.notion.com/mcp` | Notion MCP 서버 주소 (테스트가 가짜 서버로 바꾼다) |

## 8. 새 연결 대상 더하기

- 프리셋(`integration-providers.ts`)에 키·표시명·`protocol`·주소·필요한 도구를 더하고 shared `INTEGRATION_PROVIDER`에 키를 더한다. 테이블은 그대로 쓴다.
- **MCP 서버**(OAuth 동적 등록 지원)면 `McpClientService.withSession`으로 도구를 부르는 서비스(예: `notion/notion-page.service.ts`)와 그 서버에 맞춘 파일(`notion.tools.ts`처럼) 하나를 만든다.
- **REST API + OAuth 2.0**(Google Drive 계획): MCP 클라이언트를 쓰지 않는다. `IntegrationTokenStore`(암호화 읽기·쓰기: 클라이언트 정보에 관리자가 넣은 client id·secret, 토큰, code verifier)와 `integration_connection`의 `oauth_state` 콜백 확인을 그대로 쓰고, 인가 주소 만들기·토큰 교환·갱신만 새로 만든다. 콜백 경로(`integrations/oauth/callback`)는 `state`로 행을 찾으므로 `protocol`에 따라 MCP·OAuth2 처리로 나누면 된다.

## 9. 오류 코드

🟡 INT-는 정의서 9.3에 없다. `shared/src/errors.ts`에 두었고 팀 확인 후 정의서에 올린다.

| 코드 | 문구 | status |
| --- | --- | --- |
| INT-001 | 지원하지 않는 연결 대상입니다 | 404 |
| INT-002 | 연결되어 있지 않아요. 관리자가 먼저 연결해 주세요 | 409 |
| INT-003 | 연결이 끊겼어요. 관리자가 다시 연결해 주세요 | 409 |
| INT-004 | 외부 서비스 요청이 실패했어요 (이유는 문구에 담는다) | 502 |
| INT-005 | 외부 서비스에 필요한 도구가 없어요 | 502 |
| INT-006 | Notion 상위 페이지가 설정되지 않았어요. 관리자가 연결 설정에서 정해 주세요 | 409 |
| INT-007 | 연결 요청이 만료됐거나 올바르지 않아요. 처음부터 다시 연결해 주세요 | 400 |
| INT-008 | 서버 암호화 키(INTEGRATION_SECRET_KEY)가 없거나 올바르지 않아요 | 500 |

설정의 상위 페이지를 읽지 못하면 `COM-004`(400), 권한이 없으면 `COM-002`(403). 작업 로그는 남기지 않는다(REQ-LOG-002에 외부 연결 이벤트가 없다).

## 10. 테스트

- `integration.spec.ts` (묶음 `fs_collab`): 이 파일 안에 **가짜 OAuth·MCP 서버**(SDK `Server` + Streamable HTTP, 보호 자원·인가 서버 메타데이터, 동적 등록, PKCE 확인 토큰 교환, 리프레시)를 띄우고 `NOTION_MCP_URL`을 그쪽으로 바꾼다. 목록·권한, 설정(주소 → id, 잘못된 값), 연결 시작(등록·PKCE·state, 비밀값 암호문), 콜백(로그인 없이 302·재사용 거절), 연결 확인, 만료 토큰 갱신, 회의록 내보내기 규칙(작성자·관리자·그 밖, 확정 전, 두 번째, 상위 페이지 없음, 도구 없음), 토큰 취소 → `RECONNECT_REQUIRED`·`INT-003`, 끊기.
- 순수 단위(DB 없음, `npm run test:unit`): `integration-crypto.unit.spec.ts`(왕복·위변조·다른 키·키 형식), `notion/notion.tools.unit.spec.ts`(페이지 id 읽기·입력 만들기·결과 읽기), `meeting-minutes/meeting-notion.markdown.unit.spec.ts`.
- 실제 Notion은 자동 테스트하지 않는다: 관리자가 브라우저에서 허용해야 한다. 직접 확인하는 법은 아래.

**실제 Notion으로 확인하기**
1. `server/.env`에 `INTEGRATION_SECRET_KEY`를 넣고 서버를 띄운다(`npm run dev`, 서버 8787·화면 5173).
2. 관리자(1503001)로 로그인한 쿠키로 `PUT /api/v1/integrations/notion/settings {"parentPage":"<Notion 페이지 링크>"}`.
3. `POST /api/v1/integrations/notion/connect` → 응답 `authorizationUrl`을 **같은 PC의 브라우저**에서 열어 Notion 계정으로 허용한다. 콜백 뒤 `http://localhost:5173/admin/integrations?integration=notion&result=connected`로 돌아온다(화면이 아직 없으면 주소창의 쿼리만 확인).
4. `POST /api/v1/integrations/notion/test` → `ok: true`, `missingTools: []`.
5. 확정한 회의록으로 `POST /api/v1/meeting-minutes/:id/notion-export` → 응답의 `notionPageUrl`을 열어 페이지를 확인한다.
