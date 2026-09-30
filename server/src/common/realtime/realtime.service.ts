import { Injectable } from '@nestjs/common';
import { runAfterCommit } from '../../prisma/prisma.service';
import { employeeChannel, RealtimeGateway } from './realtime.gateway';

/**
 * 화면 갱신용 주제. 클라이언트는 받은 주제에 해당하는 조회를 다시 불러온다.
 * 모듈 이름(kebab-case)을 그대로 쓴다: 'sales-orders', 'inventories', 'lots', 'production-plans', ...
 */
export type RealtimeTopic = string;

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** 업무 데이터가 바뀌었음을 모든 접속자에게 알린다. 트랜잭션 안에서 부르면 커밋 뒤에 나간다. */
  changed(...topics: RealtimeTopic[]): void {
    runAfterCommit(() => this.gateway.server?.emit('changed', { topics }));
  }

  /** 특정 사원들에게만 보낸다 (메시지·알림). */
  toEmployees(employeeIds: number[], event: string, payload: unknown): void {
    if (!employeeIds.length) return;
    runAfterCommit(() => {
      for (const id of new Set(employeeIds)) this.gateway.server?.to(employeeChannel(id)).emit(event, payload);
    });
  }
}
