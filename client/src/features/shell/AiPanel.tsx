'use client';

// AI 어시스턴트 패널 (P2라 디자인만, SPEC 1장). 더 넓게(SPEC 4장 4번), 여는 버튼은 상단 바(4장 5번).
import { AiMark, ComingSoon, SoonBanner } from '@/components/ComingSoon';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { ROLE_LABEL, type RoleCode } from '@/codes';
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

const QUESTION_CHIP =
  'inline-flex min-h-7 items-center gap-1.5 rounded-[14px] border border-ai-line bg-ai-bg px-2.5 py-1 text-left text-xs leading-4 font-medium text-ai-strong';

export function AiPanel() {
  const me = useMe();
  const close = useShellStore((state) => state.closeAiPanel);
  const roleLabel = ROLE_LABEL[me.roleCode];

  return (
    <aside aria-label="AI 어시스턴트" className="absolute inset-y-0 right-0 z-10 flex w-[min(620px,46vw)] min-h-0 flex-col border-l border-ai-line bg-surface shadow-pop">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-ai-line bg-ai-bg pr-2 pl-3.5">
        <AiMark />
        <b className="text-base font-semibold text-ai-strong">AI 어시스턴트</b>
        <ComingSoon grade="P2" />
        <IconButton icon="x" label="패널 닫기" size="sm" tone="ai" className="ml-auto" onClick={close} />
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
          <b className="text-xs font-semibold">추천 질문</b>
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
