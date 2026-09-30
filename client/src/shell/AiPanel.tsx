// AI 어시스턴트 패널. 기능은 P2라 디자인(화면)만 남긴다 (SPEC 3번).
// v2 개선: 패널을 더 넓게(5-4), 여는 버튼은 상단 바로 옮김(5-5).
import type { AuthUser } from '@fantasteel/shared';
import { ROLE_CODE_LABEL, type RoleCode } from '@fantasteel/shared';
import { ComingSoon, Icon } from '@/components/ui';

const SUGGEST: Record<string, string[]> = {
  SALES: ['납기 위험 수주 알려줘', '이 수주 진행 상황 알려줘', 'SS275 코일 재고 몇 개야?'],
  PURCHASE: ['원료 부족 현황 알려줘', '입고 예정 알려줘', '구매요청은 어떻게 등록해?'],
  PRODUCTION: ['지금 진행 중인 히트 알려줘', '히트 편성이 뭐야?', '여재 슬래브 몇 매 있어?'],
  QUALITY: ['최근 불합격 현황 알려줘', '이 LOT 역추적해줘', '비슷한 사례 찾아줘'],
  LOGISTICS: ['출하요청 현황 알려줘', '출고 확정은 어떻게 해?', '밀시트는 어디서 봐?'],
  ADMIN: ['역할별 권한 알려줘', '부서장은 어떻게 지정해?', '용어 사전에서 여재 찾아줘'],
};

export function AiPanel({ me, onClose }: { me: AuthUser; onClose: () => void }) {
  const role = ROLE_CODE_LABEL[me.roleCode as RoleCode] ?? me.roleCode;
  return (
    <aside className="hl-ai hl-ai--over" aria-label="AI 어시스턴트">
      <div className="hl-ai__head">
        <span className="hl-aimark">AI</span>
        <b>AI 어시스턴트</b>
        <ComingSoon grade="P2" />
        <button type="button" className="hl-iconbtn hl-iconbtn--sm" style={{ marginLeft: 'auto' }} aria-label="패널 닫기" onClick={onClose}><Icon name="x" /></button>
      </div>
      <div className="hl-ai__body" style={{ gap: 14, padding: 16, flex: 1 }}>
        <div className="app-soon-banner">
          <Icon name="info" />
          <span>AI 어시스턴트는 2등급(P2) 기능이라 아직 답하지 않아요. 1등급 기능이 끝난 뒤 추가돼요.</span>
        </div>
        <div className="hl-col" style={{ gap: 8, opacity: 0.7 }} aria-hidden="true">
          <p className="hl-cap" style={{ lineHeight: '18px' }}>
            용어·절차를 설명하고, 내 권한({role}) 범위의 데이터를 조회해 출처와 함께 답해요. AI는 조회와 초안만 만들고, 실행은 사람이 확정해요.
          </p>
          <b style={{ fontSize: 12 }}>추천 질문</b>
          <div className="hl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {(SUGGEST[me.roleCode] ?? SUGGEST.SALES).map((q) => <button key={q} type="button" className="hl-ai-q" disabled>{q}</button>)}
          </div>
          <b style={{ fontSize: 12, marginTop: 6 }}>처음 쓰는 분께</b>
          <div className="hl-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {['예약과 배정은 뭐가 달라?', '여재가 뭐야?', '수주부터 출하까지 순서 알려줘'].map((q) => <button key={q} type="button" className="hl-ai-q" disabled>{q}</button>)}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <div className="hl-composer">
          <textarea className="hl-input" rows={2} placeholder="AI에게 묻기 — 준비 중 (P2)" aria-label="AI에게 질문" disabled style={{ width: '100%', resize: 'none' }} />
          <div className="hl-composer__bar">
            <span className="hl-cap">Enter 보내기</span>
            <button type="button" className="hl-btn hl-btn--ai hl-btn--sm" style={{ marginLeft: 'auto' }} disabled aria-label="보내기"><Icon name="send" /></button>
          </div>
        </div>
      </div>
      <div className="hl-ai__foot hl-row" style={{ gap: 6, padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
        <Icon name="lock" size="sm" />AI는 조회와 초안만 만들어요 · 반영은 사람이 확정 · 내 권한({role}) 범위
      </div>
    </aside>
  );
}
