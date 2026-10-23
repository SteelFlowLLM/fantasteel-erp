import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

/** .env.example의 로컬 비밀키. 누구나 아는 값이라 운영에서 쓰면 토큰을 위조할 수 있다 */
const LOCAL_JWT_SECRET = 'change-me-local-only';

/** 운영(NODE_ENV=production)에서는 비밀키·DB·CORS가 코드의 localhost 기본값으로 대체된 채 뜨지 않게 한다 */
function assertProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = ['JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGIN'].filter((key) => !process.env[key]);
  if (missing.length > 0) throw new Error(`운영 환경변수가 없습니다: ${missing.join(', ')}`);
  if (process.env.JWT_SECRET === LOCAL_JWT_SECRET) throw new Error('JWT_SECRET이 로컬 기본값입니다. 운영 비밀키로 바꿔 주세요');
}

async function bootstrap() {
  assertProductionEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // 같은 서버의 Caddy·Next 화면 서버(루프백)가 넘겨 준 X-Forwarded-For만 믿어 req.ip를 사용자 IP로 읽는다 (로그인 실패 횟수 제한, 이슈 #485)
  app.set('trust proxy', 'loopback');
  // 종료 신호(SIGTERM·SIGINT, pm2 restart·stop)에 모듈의 onModuleDestroy·종료 훅이 돌아 일꾼·소켓·DB 연결을 정리하게 한다
  app.enableShutdownHooks();
  // AI 어시스턴트 질문에 사진(최대 4장 × 2MB, base64)이 실린다. 기본 100kb로는 받지 못한다
  app.useBodyParser('json', { limit: '12mb' });
  app.setGlobalPrefix('api/v1');
  // 프론트 origin만 허용하고 쿠키를 주고받는다 (컨벤션 6장)
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.API_PORT ?? 8787));
}
void bootstrap();
