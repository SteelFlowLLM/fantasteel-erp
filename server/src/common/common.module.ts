import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthTokenService } from './auth/auth-token.service';
import { AuthUserRepository } from './auth/auth-user.repository';
import { AuthUserService } from './auth/auth-user.service';
import { BusinessEventRecorder } from './business-event/business-event.recorder';
import { NumberingRepository } from './numbering/numbering.repository';
import { NumberingService } from './numbering/numbering.service';
import { StorageService } from './storage/storage.service';

/** 모든 모듈이 import 없이 쓰는 공통 서비스 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'change-me-local-only',
      // 토큰 만료·갱신 방식은 비기능 요구사항 결정 후 정한다 (컨벤션 6장). 그전까지 .env의 JWT_EXPIRES_IN
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '12h') as `${number}h` },
    }),
  ],
  providers: [AuthTokenService, AuthUserRepository, AuthUserService, NumberingRepository, NumberingService, BusinessEventRecorder, StorageService],
  exports: [AuthTokenService, AuthUserService, NumberingService, BusinessEventRecorder, StorageService],
})
export class CommonModule {}
