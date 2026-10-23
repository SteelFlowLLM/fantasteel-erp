import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AI_RESEARCH_LIMITS, type AiActionCardExecuteResult, type AiResearchCard, type AuthUser } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { AiResearchService } from '../ai-research/ai-research.service';
import type { ExecuteAiActionCardDto } from './dto/ai-assistant.dto';
import { requiredString, ToolArgumentError } from './tools/assistant-tool';

type ProposedResearchCard = Omit<AiResearchCard, 'key'>;

/** 카드 제안은 DB를 보지 않는다: 질문 길이만 확인한다 (모델·동시 진행 수는 실행할 때 조사 service가 본다) */
export function proposeResearchCard(args: Record<string, unknown>): ProposedResearchCard {
  const question = requiredString(args, 'question', AI_RESEARCH_LIMITS.questionMax);
  if (question.length < AI_RESEARCH_LIMITS.questionMin) throw new ToolArgumentError(`question은 ${AI_RESEARCH_LIMITS.questionMin}자 이상이어야 해요`);
  return { kind: 'RESEARCH', title: '심층 조사 만들기', question, issues: [] };
}

/**
 * 철강맨AI의 심층 조사 만들기 카드 (문서에 없는 기능, 2026-10-19 이슈 #408). "이거 심층 조사해 줘"를 대화에서 조사로 잇는다.
 * 카드는 질문만 담고, 앞 답의 웹 검색 결과(seed)는 화면이 실행할 때 함께 보낸다. 실행은 심층 조사 화면의 [조사 만들기]와 같은 service를 부른다
 * (모델 확인·사원당 동시 3개 제한 그대로). 조사는 계획 확인 대기에서 멈추므로 사용자가 계획을 보고 시작한다. 작업 로그 대상이 아니다(REQ-LOG-002).
 */
@Injectable()
export class AiResearchCardService {
  constructor(@Inject(forwardRef(() => AiResearchService)) private readonly research: AiResearchService) {}

  async execute(user: AuthUser, dto: ExecuteAiActionCardDto): Promise<AiActionCardExecuteResult> {
    const question = dto.question?.trim() ?? '';
    if (question.length < AI_RESEARCH_LIMITS.questionMin) throw new AppException('ACT-001', `조사할 질문을 ${AI_RESEARCH_LIMITS.questionMin}자 이상 써 주세요`);
    const run = await this.research.create(user, { question, seed: dto.seed });
    return { kind: 'RESEARCH', registered: { type: 'research', id: run.id } };
  }
}
