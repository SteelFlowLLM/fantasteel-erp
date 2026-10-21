import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt.limiter';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, LoginAttemptLimiter],
})
export class AuthModule {}
