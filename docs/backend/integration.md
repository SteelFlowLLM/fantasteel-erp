# integration — 외부 서비스 연결 (Notion MCP · Google Drive)

> 근거 약어: [02] 요구사항 정의서 · [05] 코드 컨벤션 · [ERD] `docs/erd/fantasteel_erp_p1.dbml`. 🟡 = 문서에 없어 정한 값.
> 경로는 컨트롤러에 쓰는 모양(전역 prefix `/api/v1` 제외).

## 1. 담당 범위

| 항목 | 내용 |
| --- | --- |
| 이슈 | #358 MCP 연결과 회의록 Notion 내보내기 (AI 기능 계획 1단계). 🟡 설계 문서에 없는 기능 |
| 1단계 | 회사 Notion 계정 하나를 원격 MCP 서버(`https://mcp.notion.com/mcp`)에 OAuth로 연결하고, 확정한 회의록을 Notion 페이지로 내보낸다 ([meeting-minutes.md](meeting-minutes.md) 'Notion으로 내보내기') |
| 2단계 | 이슈 #361 **Google Drive 연결과 녹음 가져오기**. 회사 Google 계정 하나를 Drive REST API v3 + 일반 OAuth 2.0으로 연결하고, 관리자가 정한 폴더의 녹음·사진을 목록·내용으로 보여 주며, 녹음으로 회의록을 만든다 (11장, [meeting-minutes.md](meeting-minutes.md) 'Drive 녹음으로 만들기') |

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
| `oauth_client_information` | OAuth 클라이언트 정보 **암호문**. MCP는 동적 등록 결과, Google Drive는 관리자가 넣은 `{ clientId, clientSecret }` |
| `oauth_tokens` | 액세스·리프레시 토큰 **암호문**. MCP는 SDK가 준 모양 그대로(`issuer` 포함), Google Drive는 `{ accessToken, refreshToken, expiresAt(epoch ms), scope }` |
| `oauth_code_verifier` | PKCE code verifier **암호문**. 연결 중에만 있다 |
| `oauth_state`, `oauth_state_expires_at` | 콜백 확인값(32바이트 무작위, unique)과 만료(10분). 연결 중에만 있다 |
| `settings` jsonb | 연결별 설정. Notion: `{ parentPageId }` (32자리 소문자 16진수). Google Drive: `{ folderId }` (Drive 폴더 id) |
| `connected_by_id` | 마지막으로 연결을 시작한 관리자 |
| `connected_at` | 연결 완료 시각. **토큰이 없는데 값이 있으면 다시 연결해야 한다** |
| `last_error` | 마지막 실패 이유 (500자, 비밀값 없음) |

상태(`IntegrationConnectionStatus`)는 저장하지 않고 계산한다: 토큰 있음 → `CONNECTED`, 토큰 없음 + `connected_at` 있음 → `RECONNECT_REQUIRED`, 그 밖 → `NOT_CONNECTED`.

## 3. API

| Method | Path | 이름 | 권한 |
| --- | --- | --- | --- |
| GET | `integrations` | 연결 대상 목록·상태·설정 (`IntegrationConnectionView[]`, 비밀값 없음) | 로그인한 전 역할 🟡 |
| PUT | `integrations/:providerKey/settings` | 설정 저장. Notion: `{ parentPage }`. Google Drive: `{ clientId?, clientSecret?, folder? }` (모든 칸: 보내지 않으면 그대로, `null`·빈 글은 비움) | `ORG_MANAGE` 사용 |
| POST | `integrations/:providerKey/connect` | 연결 시작 → `{ authorizationUrl }` | `ORG_MANAGE` 사용 |
| GET | `integrations/oauth/callback` | OAuth 콜백 → 화면으로 302 | **공개**(`@Public`), `state`로 확인 |
| POST | `integrations/:providerKey/disconnect` | 연결 끊기 | `ORG_MANAGE` 사용 |
| POST | `integrations/:providerKey/test` | 연결 확인 (`IntegrationTestResult`, 실패도 결과로). MCP: 도구 목록. Google Drive: 폴더 이름과 녹음·사진 수(`driveFolder`) | `ORG_MANAGE` 사용 |
| GET | `integrations/google-drive/files?kind=audio\|image&pageToken=` | 🟡 설정한 폴더의 녹음 또는 사진 (`DriveFilePage`, 최신 수정순 50개) | 로그인한 전 역할 🟡 |
| GET | `integrations/google-drive/files/:fileId/content` | 🟡 파일 내용 그대로 (응답 포맷으로 감싸지 않는다) | 로그인한 전 역할 🟡 |
| POST | `meeting-minutes/:id/notion-export` | 회의록 내보내기 ([meeting-minutes.md](meeting-minutes.md)) | 작성자 또는 `ORG_MANAGE` 사용 |
| POST | `meeting-minutes/audio/from-drive` | Drive 녹음으로 회의록 만들기 ([meeting-minutes.md](meeting-minutes.md)) | 로그인한 전 역할 |

- 🟡 설정 전용 권한 코드가 없어 LLM 연결 설정처럼 `ORG_MANAGE`를 쓴다(가정).
- 🟡 목록은 로그인만 본다: 회의록 화면이 내보내기 버튼을 보일지(`status === 'CONNECTED'`, `settings.parentPageId` 있음) 정하려고 읽는다. 비밀값은 응답에 없다.
- 🟡 Drive 파일 목록·내용도 로그인만 본다: 회사가 녹음·사진을 함께 올리는 폴더이고, 읽기만 하며, 설정한 폴더 바로 아래 파일만 연다.
- `providerKey`는 `notion`·`google-drive`(`INTEGRATION_PROVIDER`). 모르는 키는 `INT-001`. 다른 연결 대상의 설정 칸을 보내면(예: Notion에 `clientId`) `COM-004`.
- `IntegrationConnectionView`에 OAUTH2 연결(Google Drive)만 값이 있는 칸: `redirectUri`(관리자가 Google Cloud Console에 등록할 주소 = `{SERVER_PUBLIC_URL}/integrations/oauth/callback`), `oauthClient { clientId, clientSecretSet }`(client secret은 돌려주지 않고 넣었는지만). MCP는 둘 다 `null`.

## 4. OAuth 흐름 — Notion (MCP 인가 규격: 발견 + 동적 클라이언트 등록 + PKCE)

공식 SDK `@modelcontextprotocol/sdk`(1.32)의 `auth()`·`StreamableHTTPClientTransport({ authProvider })`를 쓴다. `McpOAuthProvider`가 SDK의 `OAuthClientProvider`를 DB(암호화)에 붙인다.

1. 화면(관리 > 외부 연결)이 `POST integrations/notion/connect`를 부른다. 서버는 `oauth_state`(10분)와 `connected_by_id`를 적고 `auth()`를 부른다(SDK에는 옛 토큰을 없는 것처럼 보여 갱신 대신 허용 화면으로 가게 한다). **지금 쓰는 토큰은 지우지 않는다**: 허용이 끝나 새 토큰을 받을 때 덮어쓰므로, 관리자가 허용을 그만둬도 기존 연결은 그대로 쓴다. 순서: 보호 자원 메타데이터(RFC 9728) → 인가 서버 메타데이터 → (등록 정보가 없거나 redirect URI가 바뀌었으면) 동적 등록 → code verifier 저장 → 허용 화면 주소를 응답으로 돌려준다.
2. 화면이 브라우저를 `authorizationUrl`로 옮긴다. 관리자가 Notion에서 워크스페이스·페이지 접근을 허용한다.
3. Notion이 브라우저를 `GET {SERVER_PUBLIC_URL}/integrations/oauth/callback?code&state`로 돌려보낸다. **로그인 쿠키가 없을 수 있어 공개 경로**이고, 저장한 `state`로 연결을 찾아 **한 번만** 쓴다(조건부 UPDATE로 지움). 만료·재사용·모르는 state·`error=access_denied`는 토큰을 바꾸지 않는다. 로그인 쿠키가 함께 오면(SameSite=Lax라 이 GET에 붙는다) **연결을 시작한 관리자(`connected_by_id`)와 같은 사원이어야** 하고, 다르면 state를 버리고 오류로 돌려보낸다. 쿠키가 없으면 state만 본다.
4. `auth({ authorizationCode })`로 토큰을 받아 옛 토큰을 덮어쓰고(암호화) code verifier를 지운다. `connected_at`을 적고 브라우저를 `{CLIENT_BASE_URL}/admin/integrations?integration=notion&result=connected`로 보낸다. 실패하면 `result=error&message=…`(그리고 `last_error`).

**호출할 때** (`McpClientService.withSession`): 부를 때마다 연결을 열고 닫는다. 액세스 토큰이 만료돼 401이 오면 SDK가 리프레시 토큰으로 갱신해 다시 보낸다. 백그라운드 호출은 허용 화면으로 갈 수 없으므로 SDK가 브라우저 이동을 시키면 멈추고(연결 중인 관리자의 code verifier도 덮어쓰지 않는다) 이유를 가린다:
- 리프레시 토큰이 거절됨(`invalid_grant`): SDK가 토큰을 먼저 지운다 → `RECONNECT_REQUIRED`, `INT-003`. 리프레시 토큰이 없는 토큰도 같다.
- 갱신 요청이 일시적으로 실패함(시간 초과·연결 끊김·5xx): 토큰이 남아 있다 → **토큰을 지우지 않고** `INT-004`(잠시 뒤 다시). 다음 호출이 남은 리프레시 토큰으로 이어 간다.
- 갱신한 토큰도 401: 토큰을 지우고 `INT-003`.
- 연결 문제(`INT-`)만 `last_error`에 남긴다. 업무 오류(`VOC-` 등)는 남기지 않는다. 성공하면 지운다.

토큰을 읽고 쓰는 작업은 연결 대상마다 서버 안에서 한 줄로 선다(`IntegrationTokenStore.exclusive`, `integration-lock.ts`): 도구 호출(중간의 갱신 포함), 연결 시작, 콜백의 토큰 교환, 연결 끊기. 동시 갱신으로 리프레시 토큰이 무효가 되거나, 진행 중인 갱신이 끊기 뒤에 토큰을 되살리거나, 새로 받은 토큰을 덮어쓰지 않게 한다. 🟡 서버를 여러 대 띄우면 DB 잠금이 따로 필요하다. HTTP 요청 하나와 MCP 요청 하나(보낸 때부터, 그 사이 갱신·재전송 포함)의 상한은 각각 60초 (`MCP_REQUEST_TIMEOUT_MS`).

**연결 끊기**는 우리 쪽 토큰·클라이언트 정보·확인값을 지우고 설정은 남긴다. MCP에는 토큰 취소 요청이 없으므로 Notion 쪽 허용까지 없애려면 Notion의 설정 > 연결에서 지운다.

## 5. Notion에 맞춘 부분 (`notion/notion.tools.ts` 한 곳)

- 도구 이름 `notion-create-pages`. 연결할 때마다 `listTools`로 있는지 보고, 없으면 `INT-005`.
- 입력: `{ parent: { type: 'page_id', page_id }, pages: [{ properties: { title }, content }] }`. 도구 스키마에 `allow_async`가 있으면 `false`(기본이 비동기라 바로 주소를 받으려고). 스키마에 `parent`·`pages`가 없으면 `INT-005`.
- 결과: `isError`면 만들지 않은 것이라 `INT-004`(서버 문구 300자). JSON 글·`structuredContent`에서 `url`(없으면 `id`로 `https://www.notion.so/<id>`), 그것도 없으면 글 속 Notion 주소. 성공 답인데 주소가 없으면(비동기 작업 결과 포함) **만들어졌을 수 있어** `INT-009`.
- 도구 호출 중 오류: 인증 실패·서버의 JSON-RPC 오류(시간 초과 제외)는 실행 전 거절이라 그대로 던진다. 시간 초과·연결 끊김·5xx는 Notion이 이미 만들었는지 알 수 없어 `INT-009`(Notion에서 확인한 뒤 다시 하라는 문구).
- 상위 페이지 읽기(`normalizeNotionPageId`): 32자리 16진수·대시 있는 UUID, `notion.so`·`notion.site`·`notion.com` 주소의 끝 id(제목 슬러그·퍼센트 인코딩 허용), 미리보기 쿼리 `p`를 먼저 본다. 못 읽으면 `COM-004`.
- 페이지 쓰기 권한: Notion MCP는 연결한 사람의 권한으로 쓴다. 상위 페이지는 그 계정이 편집할 수 있는 페이지여야 한다.

## 6. 보안

- 토큰·클라이언트 정보·code verifier는 **AES-256-GCM**으로 암호화해 저장한다(`integration-crypto.ts`, `v1:<iv>:<tag>:<암호문>` base64, 값마다 새 12바이트 iv, 16바이트 인증 태그로 위변조 감지. 풀 때 iv 12바이트·태그 16바이트가 아니면 거절해 짧은 태그 위조를 막는다). 키는 환경변수 `INTEGRATION_SECRET_KEY`(32바이트, base64 또는 64자리 16진수). 키가 없거나 틀리면 연결 기능만 `INT-008`로 막히고 서버는 뜬다.
- 키를 바꾸면 저장된 값을 풀 수 없어 `INT-003`(다시 연결)이 된다. 키는 커밋하지 않는다(`server/.env`).
- 비밀값은 응답·로그·`last_error`에 넣지 않는다. 로그에는 실패 문구만 남긴다(Nest `Logger`).
- 콜백은 공개지만 `state`(32바이트 무작위, 10분, 한 번)로만 연결을 찾고, 로그인한 브라우저면 연결을 시작한 관리자여야 한다. PKCE(S256)로 인가 코드를 가로채도 토큰으로 바꿀 수 없다.
- 공개 클라이언트(`token_endpoint_auth_method: none`)로 동적 등록한다. 서버가 client secret을 주면 SDK가 그것을 쓴다(암호화해 저장).
- Google Drive: 관리자가 넣은 client secret은 암호화해 두고 어떤 응답에도 돌려주지 않는다. Google 고정 주소로만 요청하고, 파일 내용은 설정한 폴더 바로 아래 녹음·사진만 상한 안에서 `nosniff`·`sandbox` 머리를 붙여 흘려보낸다(11장).

## 7. 환경변수 (`server/.env.example`)

| 변수 | 기본값 | 쓰임 |
| --- | --- | --- |
| `INTEGRATION_SECRET_KEY` | 없음(연결 기능 막힘) | 암호화 키. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `SERVER_PUBLIC_URL` | `http://localhost:{API_PORT}/api/v1` | 브라우저가 서버에 닿는 주소. redirect URI = `{이 값}/integrations/oauth/callback`. 바뀌면 다음 연결 때 클라이언트를 다시 등록한다 |
| `CLIENT_BASE_URL` | `CORS_ORIGIN`의 첫 주소 → `http://localhost:5173` | 콜백 뒤 돌아갈 화면 (`/admin/integrations`) |
| `NOTION_MCP_URL` | `https://mcp.notion.com/mcp` | Notion MCP 서버 주소 (테스트가 가짜 서버로 바꾼다) |
| `GOOGLE_API_TEST_ORIGIN` | 없음 | **테스트 전용**. Google 인가·토큰·취소·Drive 주소를 가짜 서버(`{값}/o/oauth2/v2/auth`, `/token`, `/revoke`, `/drive/v3`)로 바꾼다. `NODE_ENV=production`이면 무시한다. `.env`에 넣지 않는다 |

Google Drive의 client id·secret·폴더는 환경변수가 아니라 관리 > 외부 연결 화면에서 넣는다(DB에 암호화).

## 8. 새 연결 대상 더하기

- 프리셋(`integration-providers.ts`)에 키·표시명·`protocol`·주소·필요한 도구를 더하고 shared `INTEGRATION_PROVIDER`에 키를 더한다. 테이블은 그대로 쓴다.
- **MCP 서버**(OAuth 동적 등록 지원)면 `McpClientService.withSession`으로 도구를 부르는 서비스(예: `notion/notion-page.service.ts`)와 그 서버에 맞춘 파일(`notion.tools.ts`처럼) 하나를 만든다.
- **REST API + OAuth 2.0**(Google Drive가 예, `google-drive/`): MCP 클라이언트를 쓰지 않는다. `IntegrationTokenStore`(암호화 읽기·쓰기)와 `oauth_state` 콜백 확인을 그대로 쓰고, 인가 주소 만들기·토큰 교환·갱신을 그 연결의 클라이언트(`GoogleDriveClient`)에 둔다. `IntegrationService`의 연결 시작·콜백·끊기·연결 확인은 프리셋의 `protocol`로 MCP·OAUTH2 처리를 나눈다.

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
| INT-009 | 외부 서비스가 요청을 처리했는지 확인하지 못했어요. 결과를 직접 확인한 뒤 다시 시도해 주세요 (Notion 내보내기는 상위 페이지를 확인하라는 문구) | 502 |
| INT-010 | Google OAuth 클라이언트 id·secret이 설정되지 않았어요. 관리자가 연결 설정에서 넣어 주세요 | 409 |
| INT-011 | Google Drive 폴더가 설정되지 않았어요. 관리자가 연결 설정에서 정해 주세요 | 409 |
| INT-012 | Drive 폴더나 파일을 찾을 수 없어요 (설정한 폴더 밖·휴지통·없는 파일 모두 이 코드. 폴더 자체를 못 찾으면 폴더 설정을 확인하라는 문구) | 404 |
| INT-013 | 가져올 수 없는 종류의 파일이에요 (녹음·사진이 아님, 회의록은 녹음만) | 400 |
| INT-014 | 파일이 너무 커서 가져올 수 없어요 (녹음 500MB, 사진 20MB) | 413 |

설정의 상위 페이지·Drive 폴더·client id를 읽지 못하면 `COM-004`(400), 권한이 없으면 `COM-002`(403). 작업 로그는 남기지 않는다(REQ-LOG-002에 외부 연결 이벤트가 없다).

## 10. 테스트

- `integration.spec.ts` (묶음 `fs_collab`): 이 파일 안에 **가짜 OAuth·MCP 서버**(SDK `Server` + Streamable HTTP, 보호 자원·인가 서버 메타데이터, 동적 등록, PKCE 확인 토큰 교환, 리프레시)를 띄우고 `NOTION_MCP_URL`을 그쪽으로 바꾼다. 목록·권한, 설정(주소 → id, 잘못된 값), 연결 시작(등록·PKCE·state, 비밀값 암호문), 콜백(로그인 없이 302·재사용 거절), 연결 확인, 만료 토큰 갱신, 갱신 일시 실패 → 토큰 유지·`INT-004`·회복, 다시 연결(허용 전 옛 토큰 사용·다른 사원 콜백 거절·새 토큰), 회의록 내보내기 규칙(작성자·관리자·그 밖, 확정 전, 두 번째, 상위 페이지 없음, 도구 없음, 도구 호출 직전 잡기, 잡기를 잃으면 `COM-001`, 주소 없는 답 `INT-009`·잡기 유지, Notion 오류 `INT-004`·잡기 풀림), 토큰 취소 → `RECONNECT_REQUIRED`·`INT-003`, 끊기.
- 순수 단위(DB 없음, `npm run test:unit`): `integration-crypto.unit.spec.ts`(왕복·위변조·다른 키·키 형식·iv/태그 길이), `integration-lock.unit.spec.ts`(연결 대상별 줄), `notion/notion.tools.unit.spec.ts`(페이지 id 읽기·입력 만들기·결과 읽기), `meeting-minutes/meeting-notion.markdown.unit.spec.ts`(섹션·Notion 태그·블록 표시 막기).
- `google-drive/google-drive.spec.ts` (묶음 `fs_collab`): 이 파일 안에 **가짜 Google 서버**(토큰: 인가 코드 + PKCE 확인·client secret 확인·갱신·`invalid_grant`·취소, Drive v3: `files.get`·`files.list`(q의 부모 폴더·휴지통·MIME)·`alt=media`)를 띄우고 `GOOGLE_API_TEST_ORIGIN`으로 바꿔 끼운다. 목록(redirect URI·`oauthClient`), 연결 전 `INT-002`, client 없이 연결 `INT-010`, 설정(권한·다른 연결의 칸·잘못된 client id·파일 주소 거절, secret은 응답에 없고 암호문으로만), 연결 시작(오프라인·동의·두 권한·PKCE·state), 콜백(verifier·secret·redirect URI 확인, 토큰 암호문, state 재사용 거절), 연결 확인(폴더 이름·녹음 2·사진 4), 목록(폴더 안·휴지통 제외·최신순·SVG/PDF/폴더 제외·50개 쪽 넘기기·잘못된 kind), 내용(MIME·이름·nosniff·sandbox, 폴더 밖·휴지통·없는 파일·이상한 id `INT-012`, SVG·PDF·폴더 `INT-013`, 메타데이터 크기·Content-Length 초과 `INT-014`, 받는 중 상한 초과는 연결을 끊음), 회의록 Drive 녹음(STT에 바이트·이름·MIME 전달 → `TRANSCRIBED`, 사진·폴더 밖은 회의록 없이 거절, 받기 실패 `FAILED`), 만료 전 미리 갱신(리프레시 토큰 이어 쓰기), 401 → 한 번 갱신 후 재시도, 갱신 5xx → 토큰 유지·`INT-004`·`last_error`·회복 후 지움, `invalid_grant` → 토큰 삭제·`RECONNECT_REQUIRED`·`INT-003`, Drive 읽기 권한을 빼고 허용·틀린 코드 → 연결 안 함, 다시 연결, 끊기(허용 취소에 리프레시 토큰, client·폴더 유지), client id 변경 → 토큰 삭제(secret 교체는 유지), 폴더 비움 → `INT-011`.
- 순수 단위 `google-drive/google-drive.unit.spec.ts`: 폴더 주소·id 읽기(여러 주소 모양, 파일 주소·다른 호스트·내 드라이브 거절), 검색어(녹음·사진 MIME, 따옴표 막기), 종류·크기 상한, Drive 응답 읽기, Content-Disposition, 토큰 응답 읽기(리프레시 토큰 잇기·expires_in·Bearer 확인)·만료 여유, Drive 권한 확인, 토큰 실패 종류, 허용 화면 주소, PKCE(RFC 7636 예시), client id 모양, 운영에서 테스트 주소 무시.
- 실제 Notion·Google은 자동 테스트하지 않는다: 관리자가 브라우저에서 허용해야 한다. 직접 확인하는 법은 아래와 11장.

**실제 Notion으로 확인하기**
1. `server/.env`에 `INTEGRATION_SECRET_KEY`를 넣고 서버를 띄운다(`npm run dev`, 서버 8787·화면 5173).
2. 관리자(1503001)로 로그인한 쿠키로 `PUT /api/v1/integrations/notion/settings {"parentPage":"<Notion 페이지 링크>"}`.
3. `POST /api/v1/integrations/notion/connect` → 응답 `authorizationUrl`을 **같은 PC의 브라우저**에서 열어 Notion 계정으로 허용한다. 콜백 뒤 `http://localhost:5173/admin/integrations?integration=notion&result=connected`로 돌아온다(화면이 아직 없으면 주소창의 쿼리만 확인).
4. `POST /api/v1/integrations/notion/test` → `ok: true`, `missingTools: []`.
5. 확정한 회의록으로 `POST /api/v1/meeting-minutes/:id/notion-export` → 응답의 `notionPageUrl`을 열어 페이지를 확인한다.

## 11. Google Drive (이슈 #361)

회사 Google 계정 하나를 연결해, 팀이 녹음·현장 사진을 올리는 **Drive 폴더 하나**를 ERP에서 읽는다. 녹음은 회의록 전사로 바로 넘긴다([meeting-minutes.md](meeting-minutes.md) 'Drive 녹음으로 만들기').

- **MCP가 아니라 Drive REST API v3 + 일반 OAuth 2.0**이다. Google의 Drive MCP는 Workspace 개발자 미리보기 등록이 필요하고, 동적 클라이언트 등록이 없으며, 5MB 안팎에서 내려받기가 실패한다.
- googleapis SDK 없이 `fetch`로 부른다. 요청은 **고정된 Google 주소로만** 간다(`google-drive/google-oauth.ts`의 `googleEndpoints`: `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com/drive/v3`). 사용자가 넣은 값은 주소가 아니라 id로만 쓰므로 SSRF 여지가 없다. 테스트만 `GOOGLE_API_TEST_ORIGIN`으로 가짜 서버를 끼운다(운영에서는 무시).
- 파일: `google-drive/google-oauth.ts`(주소·PKCE·허용 화면 주소·토큰 응답 읽기, 순수), `google-drive.query.ts`(폴더 주소 읽기·검색어·종류 판정, 순수), `google-drive.client.ts`(OAuth·토큰 갱신·Drive 요청), `google-drive.service.ts`(폴더·파일 규칙, 연결 확인), `google-drive.controller.ts`(파일 목록·내용).

### 관리자 준비 (Google Cloud Console)

1. [Google Cloud Console](https://console.cloud.google.com/)에서 **프로젝트를 만든다** (예: `fantasteel-erp`).
2. **API 및 서비스 > 라이브러리 > Google Drive API > 사용 설정**. 켜지 않으면 연결 확인·목록이 `INT-004`(`Google Drive API가 꺼져 있어요`)다.
3. **OAuth 동의 화면**(Google 인증 플랫폼 > 브랜딩·대상·데이터 액세스):
   - 회사가 **Google Workspace**면 대상(사용자 유형)을 **내부(Internal)** 로 한다. 같은 조직 계정만 허용할 수 있고, Google 검수가 필요 없으며, 리프레시 토큰이 7일 만에 끝나지 않는다.
   - Workspace가 아니면(개인 Gmail 등) **외부(External)** + 게시 상태 **테스트**로 두고, **테스트 사용자**에 연결할 회사 Google 계정을 더한다. ⚠ **외부 + 테스트 상태 앱의 리프레시 토큰은 7일 뒤 만료된다**: 7일마다 `RECONNECT_REQUIRED`가 되어 관리자가 다시 연결해야 한다. 앱을 프로덕션으로 게시하면 풀리지만 `drive.readonly`는 제한된(restricted) 범위라 Google 검수가 필요하다.
   - 데이터 액세스(범위)에 `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.file`을 더한다.
4. **사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**, 애플리케이션 유형 **웹 애플리케이션**. **승인된 리디렉션 URI**에 관리 > 외부 연결 > Google Drive 카드에 보이는 주소(`redirectUri` = `{SERVER_PUBLIC_URL}/integrations/oauth/callback`, 개발 기본값 `http://localhost:8787/api/v1/integrations/oauth/callback`)를 **글자 그대로** 넣는다. Google은 localhost가 아니면 https 주소만 받는다. 자바스크립트 원본은 비워도 된다.
5. 만든 **클라이언트 ID·클라이언트 보안 비밀번호**를 ERP 화면에 넣고, 녹음·사진을 올릴 **Drive 폴더 주소**를 붙여 넣는다. 폴더는 연결할 Google 계정이 볼 수 있어야 한다(공유 드라이브 폴더도 된다).
6. **연결** → Google 계정 고르기 → 권한 허용(체크 박스가 보이면 Drive 권한을 모두 체크) → ERP 화면으로 돌아온다 → **연결 확인**으로 폴더 이름과 녹음·사진 수를 본다.

### 설정 (`PUT integrations/google-drive/settings`)

- `clientId`: `…apps.googleusercontent.com`으로 끝나는 200자 이하만, 아니면 `COM-004`. 비밀이 아니라 목록에도 보인다.
- `clientSecret`: 공백 없는 200자 이하. **저장만 하고 돌려주지 않는다**(목록은 `oauthClient.clientSecretSet`만). 둘 다 `oauth_client_information`에 `{ clientId, clientSecret }` 암호문으로 둔다. 키가 바뀌어 옛 값을 풀 수 없으면 새로 넣는 값으로 덮어쓴다. 목록에서 풀 수 없으면 '넣지 않음'으로 보인다(목록은 막지 않는다).
- **client id를 바꾸면**(비우기 포함) 옛 클라이언트로 받은 리프레시 토큰은 새 클라이언트로 갱신할 수 없어 **토큰을 지운다** → 연결했었다면 `RECONNECT_REQUIRED`. secret만 바꾸면(같은 클라이언트의 secret 교체) 토큰은 그대로다. 설정 저장은 토큰 줄(`exclusive`) 안에서 한다.
- `folder`: 폴더 id 그대로, `drive.google.com/drive/folders/<id>`(`/u/0/`·`/mobile/`·`?usp=…` 포함), `open?id=`·`folderview?id=`·`embeddedfolderview?id=`를 읽어 `settings.folderId`에 둔다(`normalizeDriveFolderId`). 파일 주소(`/file/d/…`), 내 드라이브(`my-drive`), 다른 호스트는 `COM-004`. 폴더가 정말 있는지·폴더인지는 연결 확인이 본다.

### OAuth 흐름

1. `POST integrations/google-drive/connect`: client id·secret이 없으면 확인값을 쓰기 전에 `INT-010`. `oauth_state`(10분)·`connected_by_id`·PKCE verifier(32바이트 base64url, 암호문)를 적고 허용 화면 주소를 돌려준다: `https://accounts.google.com/o/oauth2/v2/auth?client_id&redirect_uri&response_type=code&scope=drive.readonly drive.file&access_type=offline&prompt=consent&state&code_challenge&code_challenge_method=S256`. `prompt=consent`라 다시 연결해도 리프레시 토큰을 새로 받는다. 지금 쓰는 토큰은 새 토큰을 받을 때까지 그대로 쓴다.
2. Google이 브라우저를 **Notion과 같은 콜백**(`GET integrations/oauth/callback`)으로 보낸다. state 확인·한 번만·연결을 시작한 관리자 규칙은 4장과 같고, 행의 연결 대상이 OAUTH2면 `POST https://oauth2.googleapis.com/token`(`grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`, `client_secret`)으로 바꾼다.
   - `invalid_grant`(코드 만료·재사용·PKCE 불일치) → `인가 코드가 만료됐거나 올바르지 않아요`, `invalid_client`·`unauthorized_client` → `client id·secret을 확인해 주세요`, 그 밖·네트워크 → 이유를 담은 문구. 모두 화면 쿼리(`result=error&message=…`)와 `last_error`로 알린다.
   - 응답에 리프레시 토큰이 없으면 거절한다(Google 계정 > 보안 > 타사 액세스에서 이 앱을 지우고 다시 연결하라는 문구).
   - 허용한 권한(`scope`)에 `drive.readonly`(또는 `drive`)가 없으면 거절한다: Google은 권한을 하나씩 체크하게 해 Drive를 빼고 허용할 수 있다.
   - 성공 → `{ accessToken, refreshToken, expiresAt, scope }` 암호문, verifier 지움, `connected_at`.
3. **호출할 때** (`GoogleDriveClient`): 토큰 읽기·갱신·저장은 연결 대상 줄(`store.exclusive('google-drive')`) 안에서만 하고, Drive 요청 자체는 줄 밖에서 보낸다(큰 녹음을 받는 동안 다른 호출이 기다리지 않게).
   - 액세스 토큰이 **만료 60초 전**이면 미리 갱신한다(`grant_type=refresh_token` + client id·secret). 갱신 응답에 리프레시 토큰이 없으면(Google은 보통 주지 않는다) 이전 것을 이어 쓴다.
   - 갱신이 `invalid_grant`(취소·비밀번호 변경·오래 안 씀·외부+테스트 7일) → **토큰을 지우고** `RECONNECT_REQUIRED`, `INT-003`.
   - `invalid_client`·`unauthorized_client` → `INT-004`(client id·secret 확인 문구), 토큰은 둔다.
   - 시간 초과·연결 끊김·5xx·429 → **토큰을 지우지 않고** `INT-004`(잠시 뒤 다시). 다음 호출이 남은 리프레시 토큰으로 이어 간다.
   - Drive가 401 → 줄에서 그 토큰이 아직 저장돼 있으면 한 번 갱신해 다시 보낸다(그 사이 다른 호출이 갱신했으면 그 토큰을 쓴다). 다시 401이면 그 토큰일 때만 지우고 `INT-003`.
   - Drive 오류: 404 → `INT-012`, `accessNotConfigured` → Drive API를 켜라는 문구, `insufficientPermissions` → 다시 연결하며 권한을 모두 허용하라는 문구, 429·`rateLimitExceeded` → 잠시 뒤, 그 밖 → Google 문구(200자). 모두 `INT-004`(404 제외).
   - 연결 문제(`INT-003`·`INT-004`)만 `last_error`에 남긴다. Drive 호출이 성공하면 지운다(값이 있을 때만 UPDATE).
   - 상한: 토큰·Drive JSON 요청은 60초. 내용 받기는 응답 머리까지 60초 + 조각 사이 60초(큰 녹음이라 전체 시간은 정하지 않는다).
4. **연결 끊기**: 줄 안에서 `POST https://oauth2.googleapis.com/revoke`(`token` = 리프레시 토큰, 10초, 실패해도 넘어간다) → 토큰·verifier·state·`connected_at`·`connected_by_id`·`last_error`를 지운다. **client id·secret과 폴더는 남긴다**(다시 연결할 때 다시 넣지 않게). Notion과 달리 Google 쪽 허용도 함께 없어진다.

### 파일 규칙 (`GoogleDriveService`)

- **목록** `GET integrations/google-drive/files?kind=audio|image&pageToken=`: `files.list` q = `'<folderId>' in parents and trashed = false and (<MIME>)`, `orderBy=modifiedTime desc`, `pageSize=50`, `supportsAllDrives`·`includeItemsFromAllDrives`(공유 드라이브 폴더). 녹음 MIME = `audio/*`·`video/webm`(브라우저 녹음)·`video/mp4`(회의 음성 올리기와 같은 판정 `isMeetingAudio`), 사진 = `image/*`에서 **SVG 제외**. 받은 뒤 같은 판정·부모 폴더·휴지통으로 한 번 더 거른다. **바로 아래만** 본다(하위 폴더 안은 보지 않는다).
  - 응답 `DriveFilePage { files: [{ id, name, mimeType, size(바이트|null), modifiedTime, thumbnailLink }], nextPageToken }`. `thumbnailLink`는 Drive가 준 미리보기 주소(https만, 몇 시간 뒤 만료, 브라우저의 Google 로그인 상태에 따라 안 보일 수 있어 화면은 안 보이면 내용 경로로 연다).
  - 🟡 MIME이 `application/octet-stream`으로 올라간 녹음은 Drive 검색어로 고를 수 없어 목록에 나오지 않는다(내용·회의록 경로는 확장자로 받는다).
- **내용** `GET integrations/google-drive/files/:fileId/content`: 먼저 메타데이터(`files.get`)로 확인한다 — id 모양, **설정한 폴더 바로 아래**(`parents`), 휴지통 아님 → 아니면 `INT-012`(폴더 밖 파일이 있는지 알리지 않는다). 녹음·사진이 아니면 `INT-013`. 크기 상한: 녹음 500MB(`MEETING_AUDIO_MAX_BYTES`), 사진 20MB(`DRIVE_IMAGE_MAX_BYTES`) → `INT-014`(413). 그다음 `alt=media`를 압축 없이 받아 그대로 흘려보낸다. 응답 Content-Length가 상한을 넘으면 `INT-014`, **받는 중** 상한을 넘거나 60초 동안 조각이 없으면 연결을 끊는다(잘린 내용을 성공처럼 끝내지 않는다). 브라우저가 떠나면 Google 요청도 끊는다.
  - 응답 머리: `Content-Type` = Drive MIME, `Content-Disposition: inline; filename="…"; filename*=UTF-8''…`, `Content-Length` = 메타데이터 크기(있을 때), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`(이 서버 주소로 열리므로 스크립트가 돌지 않게), `Cache-Control: private, max-age=300`.
- **연결 확인** `POST integrations/google-drive/test`: 연결·폴더 설정(`INT-002`·`INT-003`·`INT-011`) → 폴더 메타데이터(폴더 MIME·휴지통 아님, 못 찾으면 폴더 설정을 확인하라는 문구) → 폴더 바로 아래 앞 1,000개에서 녹음·사진 수. 결과 `driveFolder { id, name, audioCount, imageCount, countLimited }`(`countLimited`면 더 있다). 실패도 `ok: false` + `error`로 돌려준다.
- 스키마는 바꾸지 않았다(`integration_connection` 그대로, `settings.folderId`만 더함).

### 실제 Google로 확인하기

1. 위 '관리자 준비'를 마치고 `server/.env`에 `INTEGRATION_SECRET_KEY`를 넣고 서버를 띄운다.
2. 관리자(1503001)로 로그인한 쿠키로 `PUT /api/v1/integrations/google-drive/settings {"clientId":"…","clientSecret":"…","folder":"<Drive 폴더 주소>"}`. 응답의 `redirectUri`가 Cloud Console에 넣은 주소와 같은지 본다.
3. `POST /api/v1/integrations/google-drive/connect` → `authorizationUrl`을 **같은 PC 브라우저**에서 열어 허용 → `…/admin/integrations?integration=google-drive&result=connected`.
4. `POST /api/v1/integrations/google-drive/test` → `ok: true`, `driveFolder` 수.
5. `GET /api/v1/integrations/google-drive/files?kind=audio`, `GET /api/v1/integrations/google-drive/files/<id>/content`(브라우저에서 열어 재생).
6. `POST /api/v1/meeting-minutes/audio/from-drive {"meetingMinutesTitle":"…","meetingDate":"2026-10-16","attendeeIds":[…],"driveFileId":"<id>"}` → 상세가 `TRANSCRIBED`가 되는지(STT 서버 필요).
7. 외부 + 테스트 앱이면 7일 뒤 호출이 `INT-003`이 되고 목록이 `RECONNECT_REQUIRED`가 되는지 본다.
