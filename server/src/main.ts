import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // 프론트 origin만 허용하고 쿠키를 주고받는다 (컨벤션 6장)
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.API_PORT ?? 8787));
}
void bootstrap();
