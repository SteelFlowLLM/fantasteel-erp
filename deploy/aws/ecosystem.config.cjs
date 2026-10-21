// AWS 배포용 pm2 설정 (이슈 #485). 쓰는 법: README.md 5장.
// 이 파일은 deploy/aws/에 있고, 코드 폴더(저장소 맨 위)는 CODE_DIR로 바꿀 수 있다 (기본: 이 파일 기준 두 단계 위).
const path = require('node:path');

const CODE_DIR = process.env.CODE_DIR || path.resolve(__dirname, '..', '..');

module.exports = {
  apps: [
    {
      name: 'fantasteel-server',
      // cwd는 반드시 server/: dotenv가 server/.env를 읽고, 상대 경로(secrets/)가 여기를 기준으로 풀린다
      cwd: path.join(CODE_DIR, 'server'),
      script: 'dist/main.js',
      // 서버는 한 대·프로세스 하나만 둔다 (일꾼·스케줄러·로그인 제한·소켓이 프로세스 안 메모리를 쓴다). 클러스터 모드로 늘리지 않는다
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // 종료 신호(SIGTERM)를 받은 서버가 진행 중인 요청·일꾼을 정리할 시간. 지나면 강제 종료한다
      kill_timeout: 30_000,
      // 4GB 서버에서 서버 프로세스가 램을 다 쓰지 않게 한다 (넘기면 다시 띄운다)
      max_memory_restart: '1500M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'fantasteel-client',
      cwd: path.join(CODE_DIR, 'client'),
      // Next를 직접 띄운다 (npm run start는 -H 없이 모든 주소로 연다). 밖에는 Caddy만 열고 화면은 127.0.0.1에서만 받는다
      script: path.join(CODE_DIR, 'node_modules', 'next', 'dist', 'bin', 'next'),
      args: 'start -H 127.0.0.1 -p 5173',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 10_000,
      max_memory_restart: '800M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
