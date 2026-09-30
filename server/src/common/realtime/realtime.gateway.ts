import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthUserService } from '../auth/auth-user.service';

export const employeeChannel = (employeeId: number) => `employee:${employeeId}`;

/** WebSocket Gateway. 연결 시 access token을 검증하고 사원별 채널에 넣는다 (코드 컨벤션 6장). */
@WebSocketGateway({ cors: { origin: true }, path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger('Realtime');
  @WebSocketServer() server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly authUsers: AuthUserService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? '';
      const { sub } = await this.jwt.verifyAsync<{ sub: number }>(token);
      const user = await this.authUsers.load(Number(sub));
      if (!user) throw new Error('inactive');
      socket.data.employeeId = user.employeeId;
      await socket.join(employeeChannel(user.employeeId));
    } catch {
      this.logger.warn('인증되지 않은 소켓 연결을 끊었습니다');
      socket.disconnect(true);
    }
  }
}
