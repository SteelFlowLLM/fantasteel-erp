// 철강맨AI 답의 출처·추천 질문 칩 표시. AiPanel(패널을 열 때 불러오는 큰 조각) 밖의 화면(펫·과거 사례·회의록 묻기)도 쓰므로 따로 둔다
import type { AiAssistantSource } from '@fantasteel/shared';
import type { IconName } from '@/components/Icon';

/** 답에 붙는 출처 종류 (REQ-AST-009) */
export const SOURCE_ICON: Record<AiAssistantSource['kind'], IconName> = { GLOSSARY: 'book', PROCESS: 'book', MANUAL: 'book', DATA: 'database' };
const SOURCE_LABEL: Record<AiAssistantSource['kind'], string> = { GLOSSARY: '용어 사전', PROCESS: '업무 프로세스', MANUAL: '업무 매뉴얼', DATA: '조회 데이터' };

/** 용어 사전·업무 프로세스는 ID를 함께 보이고, 조회 데이터의 id는 도구 이름(영문)이라 보이지 않는다 */
export const sourceText = (source: AiAssistantSource): string =>
  `${SOURCE_LABEL[source.kind]} · ${source.label}${source.kind === 'DATA' ? '' : ` (${source.id})`}`;

/** 펫 대화창의 추천 질문 칩(.fp-chip)과 같은 모양. 질문이 길 수 있어 한 줄로 자르지 않고 줄을 바꾼다 */
export const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-line-strong bg-surface px-2.5 py-1 text-left text-xs leading-snug font-medium text-ink-2 enabled:hover:border-steelman enabled:hover:text-steelman-ink disabled:cursor-not-allowed disabled:opacity-60';
