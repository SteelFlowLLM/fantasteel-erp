'use client';

// AI 어시스턴트 패널 (P2라 디자인만, SPEC 1장). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
// 예시 내용: 보고 있는 화면 전달(REQ-AST-007), 역할별 추천 질문·신입 가이드 질문(AST-008), 출처를 붙인 답(AST-009),
// 크게 펼치기(AST-001)는 준비 중 버튼으로만 둔다. 질문 입력·보내기는 막혀 있다.
import { usePathname } from 'next/navigation';
import { AiMark, ComingSoon, SoonBanner, soonLabel } from '@/components/ComingSoon';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL, type RoleCode } from '@/codes';
import { routeTitleOf } from '@/features/shell/routeTitles';
import { useMe } from '@/hooks/useMe';
import { useShellStore } from '@/stores/useShellStore';

/** 역할별 추천 질문 (옛 AiPanel 예시 문구, REQ-AST-008 "추천 질문도 역할별") */
const SUGGESTED_QUESTIONS: Record<RoleCode, readonly string[]> = {
  SALES: ['납기 위험 수주 알려줘', '이 수주 진행 상황 알려줘', 'SS275 코일 재고 몇 개야?'],
  PURCHASE: ['원료 부족 현황 알려줘', '입고예정 알려줘', '구매요청은 어떻게 등록해?'],
  PRODUCTION: ['지금 진행 중인 히트 알려줘', '히트 편성이 뭐야?', '여재 슬래브 몇 매 있어?'],
  QUALITY: ['최근 불합격 현황 알려줘', '이 LOT 역추적해줘', '비슷한 사례 찾아줘'],
  LOGISTICS: ['출하요청 현황 알려줘', '출고 확정은 어떻게 해?', '밀시트는 어디서 봐?'],
  ADMIN: ['역할별 권한 알려줘', '부서장은 어떻게 지정해?', '용어 사전에서 여재 찾아줘'],
};

const FIRST_TIME_QUESTIONS = ['예약과 배정은 뭐가 달라?', '여재가 뭐야?', '수주부터 출하까지 순서 알려줘'] as const;

/** 답에 붙는 출처 종류 (REQ-AST-009) */
const ANSWER_SOURCE_KINDS: readonly { icon: IconName; label: string }[] = [
  { icon: 'book', label: '용어 사전' },
  { icon: 'note', label: '업무 매뉴얼' },
  { icon: 'database', label: '조회 데이터' },
  { icon: 'link', label: '사례 번호' },
];

/** 출처를 붙인 답 예시 (용어 사전 TRM-056 예약 · TRM-060 배정 정의를 그대로 옮김) */
const EXAMPLE_ANSWER = {
  question: FIRST_TIME_QUESTIONS[0],
  lines: [
    '예약은 수주 품목을 위해 합격 재고의 매수를 확보하는 거예요. 매수 단위이고 부분 예약도 돼요.',
    '배정은 출하요청·열연 투입에 쓸 합격 LOT을 지정하는 거예요. FIFO로 추천하고 담당자가 확정해요.',
    '둘은 따로 관리해요. 예약했다고 LOT이 정해지지는 않아요.',
  ],
  sources: [
    { icon: 'book' as IconName, label: '용어 사전 · 예약 (TRM-056)' },
    { icon: 'book' as IconName, label: '용어 사전 · 배정 (TRM-060)' },
  ],
};

const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-ai-line bg-ai-bg px-2.5 py-1 text-left text-xs leading-4 font-medium text-ai-strong';

export function AiPanel() {
  const me = useMe();
  const pathname = usePathname();
  const close = useShellStore((state) => state.closeAiPanel);
  const roleLabel = ROLE_LABEL[me.roleCode];
  const screenTitle = routeTitleOf(pathname).title || '대시보드';

  return (
    <aside aria-label="AI 어시스턴트" className="absolute inset-y-0 right-0 z-10 flex w-[min(620px,46vw)] min-h-0 flex-col border-l border-ai-line bg-surface shadow-pop">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-ai-line bg-ai-bg pr-2 pl-3.5">
        <AiMark />
        <b className="text-base font-semibold text-ai-strong">AI 어시스턴트</b>
        <ComingSoon grade="P2" />
        <IconButton icon="maximize" label={`크게 펼치기 · ${soonLabel('P2')}`} size="sm" tone="ai" className="ml-auto" disabled />
        <IconButton icon="x" label="패널 닫기" size="sm" tone="ai" onClick={close} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-4">
        <SoonBanner>
          <Icon name="info" />
          <span>AI 어시스턴트는 2등급(P2) 기능이라 아직 답하지 않아요. 1등급 기능이 끝난 뒤 추가돼요.</span>
        </SoonBanner>
        <div aria-hidden="true" className="flex flex-col gap-2 opacity-70">
          <p className="text-cap leading-[18px] text-ink-3">
            용어·절차를 설명하고, 내 권한({roleLabel}) 범위의 데이터를 조회해 출처와 함께 답해요. AI는 조회와 초안만 만들고, 실행은 사람이 확정해요.
          </p>
          <span className="inline-flex items-center gap-1.5 self-start rounded-sm border border-line bg-surface-2 px-2 py-1 text-cap text-ink-2">
            <Icon name="eye" size="sm" />
            보고 있는 화면 · <b className="font-semibold">{screenTitle}</b>
            <span className="text-ink-3">(질문과 함께 보내요)</span>
          </span>
          <b className="mt-1 text-xs font-semibold">추천 질문 · {roleLabel}</b>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS[me.roleCode].map((question) => (
              <button key={question} type="button" disabled tabIndex={-1} className={QUESTION_CHIP}>
                {question}
              </button>
            ))}
          </div>
          <b className="mt-1.5 text-xs font-semibold">처음 쓰는 분께</b>
          <div className="flex flex-wrap gap-1.5">
            {FIRST_TIME_QUESTIONS.map((question) => (
              <button key={question} type="button" disabled tabIndex={-1} className={QUESTION_CHIP}>
                {question}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <b className="text-xs font-semibold">답은 이렇게 보여요</b>
            <span className="text-cap text-ink-3">예시</span>
          </div>
          <div className="self-end rounded-md rounded-br-xs bg-brand-tint px-3 py-2 text-sm text-ink">{EXAMPLE_ANSWER.question}</div>
          <div className="flex gap-2">
            <AiMark size="sm" className="mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-ai-line bg-surface px-3 py-2.5">
              <div className="flex flex-col gap-1 text-sm leading-[19px]">
                {EXAMPLE_ANSWER.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-cap">
                <span className="font-semibold text-ink-2">출처</span>
                {EXAMPLE_ANSWER.sources.map((source) => (
                  <span key={source.label} className="inline-flex items-center gap-1 text-ink-2">
                    <Icon name={source.icon} size="sm" className="text-ink-3" />
                    {source.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="text-cap leading-[18px] text-ink-3">
            답에는 늘 출처를 붙여요:{' '}
            {ANSWER_SOURCE_KINDS.map((kind) => kind.label).join(' · ')}. 숫자는 조회 결과로만 답하고, 자료에 없으면 확인할 수 없다고 답해요. 권한 밖
            요청은 담당 역할을 안내해요.
          </p>
        </div>
      </div>
      <div className="flex-none px-4 pb-2.5">
        <div className="flex flex-col rounded-md border border-line-strong bg-surface">
          <textarea
            rows={2}
            disabled
            placeholder="AI에게 묻기 — 준비 중 (P2)"
            aria-label="AI에게 질문"
            className="resize-none border-0 bg-transparent px-3 py-2.5 text-base leading-5 outline-none disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-1 px-1.5 pt-1 pb-1.5">
            <span className="text-cap text-ink-3">Enter 보내기</span>
            <Button variant="ai" size="sm" icon="send" className="ml-auto" disabled aria-label="보내기" />
          </div>
        </div>
      </div>
      <div className="flex flex-none items-center gap-1.5 border-t border-line px-4 py-2 text-cap text-ink-3">
        <Icon name="lock" size="sm" />
        AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({roleLabel}) 범위
      </div>
    </aside>
  );
}
