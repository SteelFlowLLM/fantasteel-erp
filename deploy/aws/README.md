# AWS 한 대에 배포하기 (이슈 #485)

AWS 서버 한 대(x86 Ubuntu, 4GB쯤)에서 ERP 서버(Nest, 8787)와 화면(Next, 5173)을 띄우고, **Caddy**가 HTTPS를 받아 `/api/v1`·`/socket.io`는 8787로, 나머지는 5173으로 넘긴다. DB는 **Supabase**, LLM(Unsloth)·음성 서버는 **사용자 Mac**에 두고 **Tailscale**로 부른다(Funnel은 쓰지 않는다).

```
브라우저 ──https──▶ Caddy(80·443) ─┬─ /api/v1/*, /socket.io/* ─▶ 127.0.0.1:8787 (Nest, pm2)
                                   └─ 그 밖 ─────────────────────▶ 127.0.0.1:5173 (Next, pm2)
Nest ──▶ Supabase (DATABASE_URL 6543, 마이그레이션은 개발 PC에서)
Nest ──Tailscale──▶ Mac LLM 서버·음성 서버(8001)
```

이 폴더의 파일은 **템플릿**이다. 비밀 값(비밀키·API 키·DB 주소)은 서버에서만 채우고 git에 올리지 않는다(`.gitignore`가 `deploy/**/*.env`를 막는다).

| 파일 | 서버의 어디에 두나 |
| --- | --- |
| `Caddyfile` | `/etc/caddy/Caddyfile` (도메인만 바꾼다) |
| `server.env.example` | `<코드 폴더>/server/.env` |
| `client.env.example` | `<코드 폴더>/client/.env.local` |
| `ecosystem.config.cjs` | 그대로 쓴다 (`pm2 start deploy/aws/ecosystem.config.cjs`) |

## 1. 서버 준비

- **방화벽(보안 그룹)**: 22(SSH)·80·443만 연다. 8787·5173은 열지 않는다(127.0.0.1에서만 받는다).
- **스왑 2~4GB**: 4GB 램에서 화면 빌드(Next)가 메모리를 많이 쓴다. 없으면 빌드가 죽는다.
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- **시간대·시계**: 서버 시각이 맞아야 한다(`timedatectl`). 앱은 Asia/Seoul 기준으로 "오늘"을 센다.
- **일반 사용자**(예: `ubuntu`)로 실행한다. root로 pm2를 띄우지 않는다.

## 2. 설치 순서

1. **Node.js 22.19 이상** (예: NodeSource 또는 nvm). `node -v`로 확인. 그다음 `sudo npm i -g pm2`.
2. **Caddy**(공식 apt 저장소)와 **Tailscale**(`tailscale up`으로 내 tailnet에 넣는다). 도메인(예: DuckDNS)의 A 레코드가 이 서버의 공인 IP를 가리켜야 Caddy가 인증서를 받는다.
3. **코드 받기**: `git clone <저장소 주소> ~/fantasteel-erp && cd ~/fantasteel-erp && git switch main`(배포 브랜치).
4. **`server/.env`**: `deploy/aws/server.env.example`을 `server/.env`로 복사해 채운다. `NODE_ENV=production`, `DATABASE_URL`(6543 + `?pgbouncer=true`), `DIRECT_URL`(5432), `JWT_SECRET`(새로 만든 값), `CORS_ORIGIN`·`CLIENT_BASE_URL`·`SERVER_PUBLIC_URL`(https 주소), `STORAGE_DIR`(코드 폴더 밖, 예: `/var/lib/fantasteel/storage`, `sudo mkdir -p … && sudo chown ubuntu …`). **로컬 DB 주소가 같은 파일에 남아 있으면 뒤 줄이 앞을 덮으니 한 벌만 둔다.**
5. **`client/.env.local`**: `deploy/aws/client.env.example`을 복사한다(빌드할 때 들어가는 값).
6. **`npm install`** (저장소 맨 위): shared 빌드와 Prisma Client 생성까지 자동으로 한다.
7. **`npm run generate:sql -w @fantasteel/server`**: TypedSQL 타입을 만든다. **DB에 접속하므로 `DIRECT_URL`이 맞아야 하고, Supabase 스키마가 먼저 최신이어야 한다**(개발 PC에서 최신 develop/main을 받아 DB 담당자가 `npm run db:deploy -w @fantasteel/server`로 반영한 뒤, `docs/SERVER-GUIDE.md` 8장). 이 단계가 없으면 `npm run build`가 타입 오류 약 150개로 실패한다.
8. **`npm run build`** (shared → server → client). 처음 빌드는 몇 분 걸린다. 글꼴(IBM Plex)은 저장소의 파일(`client/src/styles/fonts.css`·`fonts/`)을 쓰므로 빌드가 Google Fonts에 접속하지 않는다(인터넷이 막혀도 된다). 4GB 서버에서 메모리가 모자라 죽으면 `NODE_OPTIONS=--max-old-space-size=3072 npm run build`로 하고 스왑을 확인한다.
9. **Caddy**: `sudo cp deploy/aws/Caddyfile /etc/caddy/Caddyfile`, 도메인을 바꾸고 `sudo systemctl reload caddy`.
10. **pm2**: `pm2 start deploy/aws/ecosystem.config.cjs && pm2 save && pm2 startup`(출력된 `sudo …` 명령을 한 번 실행). 서버를 재부팅해도 자동으로 뜬다.

> 시드(`npm run seed`)는 서버에서 돌리지 않는다. 운영 DB의 조직·기준정보는 이미 Supabase에 있고, 시드를 다시 넣으면 화면에서 바꾼 값이 시드 값으로 돌아간다.

## 3. 이 설정이 정한 것

- **서버는 한 대·프로세스 하나**: 심층 조사 일꾼, 회의 전사·분석 일꾼, 스케줄러(Agent 감지·재고 보정), 로그인 실패 횟수 제한, 메신저 소켓이 프로세스 안 메모리를 쓴다. pm2를 클러스터 모드로 늘리거나 서버를 두 대 띄우지 않는다. 개발 PC의 서버도 **운영과 같은 Supabase에 붙이지 않는다**(Notion 연결·동기화·일꾼이 서로 부딪힌다). 개발 PC는 로컬 DB를 쓴다.
- **종료 처리**: 서버는 SIGTERM에 진행 중인 요청을 마무리하고 일꾼·소켓·DB 연결을 닫는다(`kill_timeout` 30초). 전사·분석·심층 조사처럼 오래 걸리는 일은 끊긴 채 남지 않고 다음에 뜰 때 이어서 하거나 실패로 정리된다.
- **로그인 실패 제한**: 사원번호별 5번·IP별 20번 틀리면 5분 막는다(메모리, 서버 한 대 가정, 재시작하면 비워짐). 사용자 IP는 Caddy가 붙인 `X-Forwarded-For`로 읽는다(서버가 루프백에서 온 값만 믿는다).
- **받아쓰기 제한 시간**: 음성 서버의 긴 전사(최대 1시간)가 기본 5분 대기에 끊기지 않게 서버가 받아쓰기 요청에만 대기 시간을 맞춘다.
- **스트리밍**: Caddy는 `/api/v1`·`/socket.io`에 압축을 걸지 않고 응답을 모으지 않는다(철강맨AI 답이 한꺼번에 나오지 않게).
- **설정 파일 권한**: 서버가 `STORAGE_DIR/settings/`에 쓰는 설정 파일(LLM·음성·철강맨 부르기·브라우저)에는 API 키가 들어 있어 새로 쓸 때 폴더 0700·파일 0600으로 만든다. 이 버전 전에 만든 파일·폴더는 권한이 그대로이니 서버에서 한 번 맞춘다: `chmod 700 "$STORAGE_DIR/settings" && chmod 600 "$STORAGE_DIR"/settings/*.json`.
- **EC2 메타데이터(IMDSv2)**: ERP 서버가 관리자가 넣은 주소로 요청을 보내므로 인스턴스 자격 증명이 새지 않게 IMDSv2를 필수로 두고 hop limit을 1로 한다(서버 코드도 메타데이터 주소를 막지만 한 겹 더): `aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1`.
- **요청 본문 상한**: 파일을 올리는 경로(회의 녹음·음성 시험 오디오·메신저 첨부)만 510MiB까지 받고, 나머지 API는 13MiB(철강맨AI 질문에 실린 사진까지), 실시간 연결·화면은 2MiB다. Caddy는 `MB`를 10^6바이트, `MiB`를 2^20바이트로 읽고 서버 상한은 2^20 기준이라 `Caddyfile`에는 `MiB`로 적는다. 새 파일 올리기 경로를 서버에 더하면 `Caddyfile`의 `@bigUpload` 목록에도 더한다(`deploy-caddyfile.unit.spec.ts`가 서버의 업로드 경로와 이 목록·크기를 맞춰 본다).

## 4. 외부 연결

- **Mac LLM·음성 서버**: `LLM_BASE_URL`·`STT_BASE_URL`은 Mac의 **Tailscale 주소**(`100.x.y.z` 또는 `…ts.net`)로 적는다. Mac의 서버가 `127.0.0.1`이 아니라 Tailscale 주소로도 받아야 하고, Mac이 **잠자기에 들어가지 않게** 한다(시스템 설정 > 잠자기 방지, 전원 연결). Mac이 꺼져 있으면 철강맨AI·음성이 `AST-003`(연결 실패) 안내를 낸다. Funnel(공개 주소)은 쓰지 않는다.
- **Notion**: Mac에서 한 연결은 옮겨지지 않는다. 서버를 띄운 뒤 화면 `관리 > 외부 연결`에서 **AWS 주소로 다시 연결**한다(허용 뒤 돌아오는 주소가 `SERVER_PUBLIC_URL/integrations/oauth/callback`이다).
- **Google Drive**: 서비스 계정 키 파일을 `scp`로 서버의 `server/secrets/`에 복사하고 `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`에 상대 경로를 적는다(또는 base64 한 줄을 `GOOGLE_SERVICE_ACCOUNT_KEY`에).
- **AI 브라우저**: 처음에는 끈다(`AI_BROWSER_ENABLED=false`). 켜려면 서버에 Google Chrome을 깔고 `BROWSER_EXECUTABLE_PATH`를 맞춘 뒤 램(Chrome 하나가 수백 MB)을 지켜본다.
- **ERP 화면 조작**: 시험 중이라 끈다(`AI_SCREEN_CONTROL_ENABLED=false`).

## 5. 확인 목록

```bash
pm2 status                                   # 두 앱이 online
pm2 logs fantasteel-server --lines 50        # "Nest application successfully started", 오류 없음
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/api/v1/auth/me   # 401 (로그인 전이라 정상)
curl -sI https://<도메인>/login | head -1    # HTTP/2 200
```

- 브라우저로 `https://<도메인>` → 로그인 → 대시보드가 뜬다. 사원 메뉴가 사원 권한대로 보인다.
- 메신저 두 계정(시크릿 창)으로 메시지가 실시간으로 간다(웹소켓).
- 철강맨AI 질문의 답이 **조금씩 흐르듯** 나온다(Caddy가 모으지 않는다). Mac이 켜져 있으면 답, 꺼져 있으면 `AST-003` 안내.
- 회의 녹음(수 MB)을 올려 전사가 끝난다. 녹음 올리기 경로(`/api/v1/meeting-minutes/audio`)는 Caddy·서버 상한(500MiB)을 모두 지난다.
- 쿠키가 `Secure`·`HttpOnly`로 오고, 한 사원번호를 6번 틀리면 `AUTH-003`(429)이다.
- `free -h`로 램·스왑을 본다. 서버 프로세스가 1.5GB를 넘으면 pm2가 다시 띄운다.

## 6. 새 버전 올리기

```bash
cd ~/fantasteel-erp && git pull
npm install
npm run generate:sql -w @fantasteel/server   # 새 SQL이 생겼을 수 있다. 먼저 개발 PC에서 db:deploy로 스키마를 반영해 둔다
npm run build
pm2 reload deploy/aws/ecosystem.config.cjs   # server는 SIGTERM으로 정리한 뒤 다시 뜬다
```

스키마가 바뀌는 배포는 **DB 반영 → 서버 배포** 순서로 한다(칸 삭제·이름 변경은 옛 코드가 바로 깨지므로 미리 공지, `docs/SERVER-GUIDE.md` 8장).

## 7. 백업·점검

- `STORAGE_DIR`(메신저 첨부·`settings/*.json`)은 서버 디스크에만 있다. 주기적으로 복사해 둔다.
- 로그: `pm2 logs`, `~/.pm2/logs/`(회전하려면 `pm2 install pm2-logrotate`).
- 서버 시각·디스크(`df -h`)·스왑 사용량을 가끔 본다.
