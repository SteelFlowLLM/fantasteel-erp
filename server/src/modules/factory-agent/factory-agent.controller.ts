import { Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type { AgentExplainView, AgentScanView, AuthUser } from '@fantasteel/shared';
import { CurrentUser } from '../../common/auth/auth.decorators';
import { FactoryAgentService } from './factory-agent.service';

/**
 * 라우팅만 둔다 (컨벤션 6장). 감지는 스케줄·이벤트로 서버 안에서 돌고, 관리자가 바로 돌리는 API(agent/scan)만 있다.
 * 후보 목록·확정·반려는 초안 API(message-action 컨트롤러)가 Agent 후보를 이 모듈로 넘긴다.
 * 권한은 후보가 만드는 업무의 권한이라 service가 데이터에 따라 확인한다.
 */
@Controller()
export class FactoryAgentController {
  constructor(private readonly service: FactoryAgentService) {}

  /** API-283 (문서 밖 기능, 이슈 #477). 관리자만: 스케줄을 기다리지 않고 위험 감지를 지금 돌린다 */
  @Post('agent/scan')
  @HttpCode(200)
  scan(@CurrentUser() user: AuthUser): Promise<AgentScanView> {
    return this.service.scanNow(user);
  }

  /** API-264 */
  @Post('action-drafts/:id/explain')
  @HttpCode(200)
  explain(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number): Promise<AgentExplainView> {
    return this.service.explain(user, id);
  }
}
