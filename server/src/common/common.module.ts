import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthUserService } from './auth/auth-user.service';
import { NumberingService } from './numbering/numbering.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { RealtimeService } from './realtime/realtime.service';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'change-me-local-only',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '12h') as never },
    }),
  ],
  providers: [AuthUserService, NumberingService, RealtimeGateway, RealtimeService, StorageService],
  exports: [AuthUserService, NumberingService, RealtimeService, StorageService],
})
export class CommonModule {}
