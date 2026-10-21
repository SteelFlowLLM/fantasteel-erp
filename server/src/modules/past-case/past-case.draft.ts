// 과거 사례 초안 (REQ-CASE-002, API-269). AI가 쓰고, AI를 못 쓰면 검사 결과로 채운다.
// AI가 쓴 값은 믿을 수 없어 모양을 확인하고, 틀리면 검사 결과 초안을 쓴다. 숫자는 검사 결과에 있는 값만 쓰게 한다.
import {
  DISPOSITION_STATUS_LABEL,
  LOT_TYPE_LABEL,
  PAST_CASE_CATEGORY,
  PROCESS_TYPE_LABEL,
  type DispositionStatus,
  type LotType,
  type PastCaseCategory,
  type PastCaseView,
  type ProcessType,
} from '@fantasteel/shared';
import type { ChatMessage, LlmJsonSchema } from '../llm/llm.client';

/** 기준을 벗어난 검사 항목 */
export interface FailedItemFact {
  name: string;
  code: string;
  value: string;
  unit: string | null;
  min: string | null;
  max: string | null;
}

/** 초안에 쓰는 불합격 사실. 상위 히트 불합격이면 viaLotNo에 그 히트가 있고 failedItems는 히트의 값이다 */
export interface FailureFacts {
  lotNo: string;
  lotType: string;
  steelGradeCode: string | null;
  processType: string | null;
  /** 검사일 YYYY-MM-DD (Asia/Seoul) */
  inspectedDate: string;
  failedItems: FailedItemFact[];
  dispositionStatus: string | null;
  dispositionReason: string | null;
  viaLotNo: string | null;
}

export interface DraftFields {
  caseCategory: PastCaseCategory;
  title: string;
  phenomenon: string;
  cause: string;
  actionTaken: string;
  equipmentText: string;
}

const lotTypeName = (lotType: string) => LOT_TYPE_LABEL[lotType as LotType] ?? lotType;
const processName = (processType: string | null) => (processType ? (PROCESS_TYPE_LABEL[processType as ProcessType] ?? processType) : '');

function limitText(item: FailedItemFact): string {
  if (item.min !== null && item.max !== null) return `${item.min}~${item.max}`;
  if (item.max !== null) return `${item.max} 이하`;
  if (item.min !== null) return `${item.min} 이상`;
  return '기준 없음';
}

/**
 * "망가니즈(MN) 1.68 % (기준 1.60 이하)", "항복강도 300 N/mm² (기준 355 이상)".
 * 원소 기호(MN·SI처럼 세 글자 이하)만 괄호로 붙인다: YIELD_STRENGTH 같은 영문 코드는 화면 글에 쓰지 않는다.
 * 검사 기준의 항목 이름은 이미 "인(P)"·"망간(Mn)"처럼 기호를 달고 있어 그때는 붙이지 않는다 ("인(P)(P)", #519)
 */
export function failedItemText(item: FailedItemFact): string {
  const unit = item.unit ? ` ${item.unit}` : '';
  const symbol = /^[A-Z]{1,3}$/.test(item.code) && !item.name.toUpperCase().includes(`(${item.code})`) ? `(${item.code})` : '';
  return `${item.name}${symbol} ${item.value}${unit} (기준 ${limitText(item)})`;
}

/** 검사 결과만으로 채운 초안. 원인·조치는 사실이 없어 비워 두고 품질 담당이 쓴다 */
export function ruleDraft(facts: FailureFacts): DraftFields {
  const kind = facts.viaLotNo ? '상위 히트 성분 불합격' : `${processName(facts.processType)} 검사 불합격`.trim();
  const title = [facts.steelGradeCode, lotTypeName(facts.lotType), kind].filter(Boolean).join(' ');
  const items = facts.failedItems.map(failedItemText);
  const phenomenon = [
    facts.viaLotNo ? `상위 히트 ${facts.viaLotNo}의 성분 검사가 불합격이에요.` : `${facts.lotNo} 검사가 불합격이에요.`,
    items.length ? `기준을 벗어난 항목: ${items.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const disposition = facts.dispositionStatus ? DISPOSITION_STATUS_LABEL[facts.dispositionStatus as DispositionStatus] : null;
  const actionTaken = disposition ? `처리 상태를 ${disposition}(으)로 지정했어요.${facts.dispositionReason ? ` 사유: ${facts.dispositionReason}` : ''}` : '';
  return { caseCategory: PAST_CASE_CATEGORY.QUALITY, title, phenomenon, cause: '', actionTaken, equipmentText: '' };
}

export const DRAFT_JSON_SCHEMA: LlmJsonSchema = {
  name: 'past_case_draft',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['caseCategory', 'title', 'phenomenon', 'cause', 'actionTaken', 'equipmentText'],
    properties: {
      caseCategory: { type: 'string', enum: ['QUALITY', 'EQUIPMENT'] },
      title: { type: 'string' },
      phenomenon: { type: 'string' },
      cause: { type: 'string' },
      actionTaken: { type: 'string' },
      equipmentText: { type: 'string' },
    },
  },
};

const DRAFT_SYSTEM_PROMPT = [
  '당신은 철강 제조 ERP "FantaSteel"의 품질 담당을 돕는 AI예요. 불합격 LOT을 과거 사례로 남길 초안을 써요.',
  '규칙:',
  '1. 모든 문장은 "~요"로 끝나는 해요체로, 짧게 써요.',
  '2. 숫자(측정값·기준)는 [불합격 사실]에 있는 값만 써요. 없는 숫자를 만들지 않아요.',
  '3. 원인은 [불합격 사실]과 [비슷한 과거 사례]에서 근거를 찾을 수 있을 때만 근거 사례 번호와 함께 "추정"이라고 밝혀서 써요(예: "CASE-0002처럼 냉각수 양이 고르지 않았던 것으로 추정돼요"). 근거가 없으면 "확인 필요"라고만 써요.',
  '4. 조치는 이미 한 일이 아니라 앞으로 할 일을 제안해요. 근거 사례가 있으면 번호와 함께 "~을 검토해요"처럼 쓰고(예: "CASE-0002처럼 냉각수 노즐 청소를 검토해요"), 없으면 "확인 필요"라고만 써요. 처리 상태가 지정돼 있으면 그 사실을 먼저 써요.',
  '5. 관련 설비는 근거가 있을 때만 텍스트로 쓰고(예: 1번 전로), 없으면 빈 문자열이에요.',
  '6. 구분(caseCategory)은 원인 칸만 보고 정해요. 원인이 설비 문제(막힘·마모·고장·설정 어긋남·측정 장치 등)면 EQUIPMENT, 원료·투입량·조업 조건처럼 설비가 아니거나 "확인 필요"면 QUALITY예요. 관련 설비가 적혀 있다고 EQUIPMENT가 되지 않아요.',
  '7. 제목은 "강종 LOT종류 불합격 내용" 꼴로 40자 안쪽이에요.',
  '8. JSON 하나만 답해요: {"caseCategory","title","phenomenon","cause","actionTaken","equipmentText"}',
].join('\n');

export function buildDraftMessages(facts: FailureFacts, similar: readonly PastCaseView[]): ChatMessage[] {
  const lines = [
    '[불합격 사실]',
    `LOT: ${facts.lotNo} (${lotTypeName(facts.lotType)}${facts.steelGradeCode ? ` · ${facts.steelGradeCode}` : ''})`,
    facts.viaLotNo ? `상위 히트 ${facts.viaLotNo}의 성분 검사 불합격으로 함께 불합격` : `검사: ${processName(facts.processType)} 불합격`,
    `검사일: ${facts.inspectedDate}`,
    `기준을 벗어난 항목: ${facts.failedItems.length ? facts.failedItems.map(failedItemText).join(', ') : '없음(필수 항목 누락 등)'}`,
    `처리 상태: ${facts.dispositionStatus ? DISPOSITION_STATUS_LABEL[facts.dispositionStatus as DispositionStatus] : '미지정'}${facts.dispositionReason ? ` · 사유: ${facts.dispositionReason}` : ''}`,
    '',
    '[비슷한 과거 사례]',
    ...(similar.length
      ? similar.map((c) => `${c.caseNo} ${c.title} / 현상: ${c.phenomenon} / 원인: ${c.cause} / 조치: ${c.actionTaken} / 설비: ${c.equipmentText}${c.isExample ? ' (예시 사례)' : ''}`)
      : ['없음']),
  ];
  return [
    { role: 'system', content: DRAFT_SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

const MAX = { title: 200, phenomenon: 2000, cause: 2000, actionTaken: 2000, equipmentText: 200 } as const;

/** 모델 답이 초안 모양이면 다듬어 돌려주고, 아니면 null (부르는 쪽이 검사 결과 초안을 쓴다) */
export function parseDraft(raw: unknown): DraftFields | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = (key: keyof typeof MAX) => (typeof r[key] === 'string' ? (r[key] as string).trim().slice(0, MAX[key]) : null);
  const title = text('title');
  const phenomenon = text('phenomenon');
  if (!title || !phenomenon) return null;
  const caseCategory = r.caseCategory === PAST_CASE_CATEGORY.EQUIPMENT ? PAST_CASE_CATEGORY.EQUIPMENT : PAST_CASE_CATEGORY.QUALITY;
  return { caseCategory, title, phenomenon, cause: text('cause') ?? '', actionTaken: text('actionTaken') ?? '', equipmentText: text('equipmentText') ?? '' };
}

/** 초안을 쓸 때 참고할 비슷한 사례를 찾는 검색어 */
export function similarQueryOf(facts: FailureFacts): string {
  return [facts.steelGradeCode, lotTypeName(facts.lotType), ...facts.failedItems.map((i) => i.name), '불합격'].filter(Boolean).join(' ');
}
