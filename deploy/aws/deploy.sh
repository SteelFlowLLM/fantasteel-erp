#!/usr/bin/env bash
# 운영 서버(EC2)에 main의 새 버전을 올린다 (이슈 #550). 쓰는 법: README.md 6장.
#   GitHub Actions(.github/workflows/deploy.yml)가 부르고, 서버에서 손으로 돌려도 된다: bash ~/fantasteel-erp/deploy/aws/deploy.sh
set -euo pipefail

# git pull이 실행 중인 이 파일을 바꿔도 bash가 바뀐 줄을 읽지 않게 전체를 함수로 먼저 읽어 둔다
main() {
  cd "$(dirname "$0")/../.."

  git fetch -q origin main
  git switch -q main
  git merge -q --ff-only origin/main
  echo "[deploy] $(git log --oneline -1)"

  # 스키마 반영은 DB 담당자가 개발 PC에서 먼저 한다 (SERVER-GUIDE 8장). 안 됐으면 옛 DB에 새 코드가 붙지 않게 여기서 멈춘다
  if ! (cd server && npx prisma migrate status); then
    echo "[deploy] 운영 DB에 반영되지 않은 마이그레이션이 있어 멈춥니다. 개발 PC에서 npm run db:deploy -w @fantasteel/server 뒤 다시 실행하세요" >&2
    exit 1
  fi

  npm ci
  npm run generate:sql -w @fantasteel/server
  NODE_OPTIONS=--max-old-space-size=3072 npm run build
  pm2 reload deploy/aws/ecosystem.config.cjs --update-env

  # 서버는 로그인 전이라 401, 화면은 200이면 뜬 것이다
  for _ in $(seq 1 30); do
    api=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/v1/auth/me || true)
    web=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/login || true)
    if [ "$api" = 401 ] && [ "$web" = 200 ]; then
      echo "[deploy] 완료 (서버 $api, 화면 $web)"
      exit 0
    fi
    sleep 2
  done
  echo "[deploy] 60초 안에 뜨지 않았습니다 (서버 $api, 화면 $web). pm2 logs로 확인하세요" >&2
  exit 1
}

main "$@"
