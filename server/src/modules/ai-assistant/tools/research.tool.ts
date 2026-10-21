import { AI_RESEARCH_STATUS, AI_RESEARCH_STATUS_LABEL, type AiResearchRunSummaryView, type AiResearchStatus } from '@fantasteel/shared';
import type { AiResearchService } from '../../ai-research/ai-research.service';
import { codeLabelList, limitRows, OPEN_ACCESS, optionalEnum, scanFiltered, seoulDateTimeText, TOOL_ROW_LIMIT, unscannedField, type AssistantTool } from './assistant-tool';

const STATUSES = Object.values(AI_RESEARCH_STATUS) as AiResearchStatus[];
/** 아직 끝나지 않은 조사: 계획 중·계획 확인 대기·차례 대기·조사 중 */
export const RUNNING_RESEARCH_STATUSES: readonly AiResearchStatus[] = [AI_RESEARCH_STATUS.PLANNING, AI_RESEARCH_STATUS.AWAITING_APPROVAL, AI_RESEARCH_STATUS.QUEUED, AI_RESEARCH_STATUS.RUNNING];
const QUESTION_PREVIEW_MAX = 100;

const NEXT_STEP: Partial<Record<AiResearchStatus, string>> = {
  [AI_RESEARCH_STATUS.AWAITING_APPROVAL]: '심층 조사 화면에서 계획을 확인하고 [시작]을 눌러야 조사가 시작돼요',
  [AI_RESEARCH_STATUS.COMPLETED]: '심층 조사 화면에서 보고서를 볼 수 있어요',
};

export function researchRow(r: AiResearchRunSummaryView) {
  return {
    조사id: r.id,
    질문: r.question.length > QUESTION_PREVIEW_MAX ? `${r.question.slice(0, QUESTION_PREVIEW_MAX)}…` : r.question,
    ...(r.title ? { 제목: r.title } : {}),
    상태: AI_RESEARCH_STATUS_LABEL[r.status],
    '진행 단계': r.maxSteps > 0 ? `${r.stepsUsed}/${r.maxSteps}` : null,
    '모은 출처 수': r.sourceCount,
    만든시각: seoulDateTimeText(r.createdAt),
    ...(r.finishedAt ? { 끝난시각: seoulDateTimeText(r.finishedAt) } : {}),
    ...(NEXT_STEP[r.status] ? { 안내: NEXT_STEP[r.status] } : {}),
  };
}

/** 내 조사 중 아직 끝나지 않은 것 (최근 1,000건 안). 브리핑이 쓴다 */
export async function readRunningResearch(research: AiResearchService, user: Parameters<AiResearchService['list']>[0]): Promise<{ rows: AiResearchRunSummaryView[]; unscanned: number }> {
  const scan = await scanFiltered(
    (page, size) => research.list(user, { page, size }),
    (r) => RUNNING_RESEARCH_STATUSES.includes(r.status),
  );
  return { rows: scan.rows, unscanned: scan.unscanned };
}

/**
 * 내 심층 조사 진행 상태 (GET ai-research/runs, 문서에 없는 기능 이슈 #506). 조사는 만든 사원 본인의 것만 보이고 남의 조사는 없는 것처럼 다룬다(service가 확인).
 * 사원 본인의 것이라 철강맨AI 패널에서만 알린다.
 */
export function myResearchTool(research: AiResearchService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    panelOnly: true,
    definition: {
      name: 'get_my_research',
      description: `내가 만든 심층 조사의 진행 상태를 조회한다. 최근 조사부터 질문·제목·상태·진행 단계(사용 단계/전체 단계)·출처 수를 준다. 끝나지 않은 조사 수도 준다. status: ${codeLabelList(AI_RESEARCH_STATUS_LABEL)}. 조사를 만들거나 보고서 본문을 읽지는 못한다.`,
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: STATUSES, description: '조사 상태 (생략하면 모두)' } },
      },
    },
    async run(args, user) {
      const status = optionalEnum(args, 'status', STATUSES);
      const scan = await scanFiltered(
        (page, size) => research.list(user, { page, size }),
        (r) => status === undefined || r.status === status,
      );
      const running = status === undefined ? scan.rows.filter((r) => RUNNING_RESEARCH_STATUSES.includes(r.status)).length : null;
      const limited = limitRows(scan.rows, TOOL_ROW_LIMIT);
      return {
        label: `내 심층 조사${status ? ` · ${AI_RESEARCH_STATUS_LABEL[status]}` : ''}`,
        data: {
          '조사 수': scan.rows.length,
          ...(running === null ? {} : { '끝나지 않은 조사 수': running }),
          조사: limited.rows.map(researchRow),
          '생략 줄 수': limited.omitted,
          ...unscannedField('조사', scan.unscanned),
        },
      };
    },
  };
}
