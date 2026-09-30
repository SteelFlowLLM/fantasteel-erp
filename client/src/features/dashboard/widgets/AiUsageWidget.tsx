// AI 활용 현황 — P2. 서버가 { available: false, grade: 'P2' }만 준다. 자리만 흐리게 남긴다 (숫자는 없다).
export function AiUsageWidget() {
  return (
    <div className="hl-card__body dsh-soon" style={{ gap: 10, padding: '12px 16px' }} aria-hidden="true">
      <div className="dsh-figures">
        <div className="hl-figure"><span>AI 어시스턴트 질문</span><b>—<small>건</small></b></div>
        <div className="hl-figure"><span>초안 작성</span><b>—<small>건</small></b></div>
        <div className="hl-figure"><span>Agent 감지</span><b>—<small>건</small></b></div>
      </div>
      <div className="hl-stack" />
      <span className="hl-cap">AI 기능(2등급)이 추가되면 사용 현황이 여기에 보여요</span>
    </div>
  );
}
