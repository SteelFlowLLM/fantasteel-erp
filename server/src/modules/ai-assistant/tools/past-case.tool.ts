import { PAST_CASE_CATEGORY_LABEL, type PastCaseCategory } from '@fantasteel/shared';
import type { PastCaseService } from '../../past-case/past-case.service';
import { OPEN_ACCESS, limitRows, optionalEnum, optionalString, type AssistantTool } from './assistant-tool';

const CATEGORIES: readonly PastCaseCategory[] = ['QUALITY', 'EQUIPMENT'];
/** 사례는 현상·원인·조치 글이 길어 목록 도구(15줄)보다 적게 넘긴다 */
const CASE_ROW_LIMIT = 5;

/**
 * 과거 사례 검색 (REQ-AST-006·REQ-CASE-003, GET /past-cases와 같은 전 역할).
 * 사례 DB가 없어 예시 사례와 등록 사례를 핵심어로 찾는다. 예시 사례는 "예시"라고 표시해 모델이 실제 사례처럼 말하지 않게 한다.
 */
export function pastCaseTool(pastCases: PastCaseService): AssistantTool {
  return {
    access: OPEN_ACCESS,
    definition: {
      name: 'search_past_cases',
      description:
        '과거 사례(불합격·설비 문제의 현상·원인·조치 기록)를 핵심어로 찾는다. "비슷한 사례 찾아줘", "SM355A 성분 불합격 사례", "가열로 문제 있었던 적 있어?"처럼 과거 사례를 물으면 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '찾을 핵심어 (예: SM355A 히트 성분 불합격, 가열로, 스케일)' },
          category: { type: 'string', enum: [...CATEGORIES], description: 'QUALITY(품질) 또는 EQUIPMENT(설비). 묻지 않았으면 비운다' },
        },
      },
    },
    async run(args) {
      const query = optionalString(args, 'query', 200);
      const category = optionalEnum(args, 'category', CATEGORIES);
      const found = await pastCases.search({ q: query, category });
      const limited = limitRows(found, CASE_ROW_LIMIT);
      return {
        label: `과거 사례${query ? ` · ${query}` : ''}${limited.rows.length ? ` · ${limited.rows.map((c) => c.caseNo).join(', ')}` : ''}`,
        data: {
          '찾은 사례 수': found.length,
          사례: limited.rows.map((c) => ({
            사례번호: c.caseNo,
            구분: PAST_CASE_CATEGORY_LABEL[c.caseCategory],
            제목: c.title,
            현상: c.phenomenon,
            원인: c.cause || '(기록 없음)',
            조치: c.actionTaken || '(기록 없음)',
            '관련 설비': c.equipmentText || '(기록 없음)',
            '관련 LOT': c.lots.map((l) => l.lotNo).join(', ') || '(없음)',
            발생일: c.occurredDate,
            예시: c.isExample ? '예시 사례(실제 사례 아님)' : '등록 사례',
          })),
          '생략 줄 수': limited.omitted,
        },
      };
    },
  };
}
