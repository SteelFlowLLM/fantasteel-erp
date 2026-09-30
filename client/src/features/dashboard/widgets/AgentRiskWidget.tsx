// Agent 위험 감지 — P2. 서버가 { available: false, grade: 'P2' }만 준다. v1 디자인의 모양만 흐리게 남긴다 (BP-DSH-01: P2 미구현 시 비활성).
import { Icon } from '@/components/ui';

export function AgentRiskWidget() {
  return (
    <div className="hl-card__body dsh-soon" style={{ gap: 9, padding: '12px 16px' }} aria-hidden="true">
      <div className="hl-row">
        <span className="hl-badge hl-badge--danger">납기 위험</span>
        <span className="hl-tag">예시</span>
        <span className="hl-ink2">수주번호 · 고객사</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px' }}>AI Factory Agent가 수주·재고·생산 진행을 살펴 위험을 찾으면 여기에 알려줘요.</p>
      <dl className="hl-exec__kv" style={{ margin: 0, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 6 }}>
        <dt>품목</dt><dd>—</dd>
        <dt>충족</dt><dd>—</dd>
        <dt>완료 예상</dt><dd>—</dd>
      </dl>
      <div className="hl-origin"><Icon name="info" size="sm" /><span>대응 후보는 부서장이 승인한 뒤 실행돼요</span></div>
      <div className="hl-row">
        <button className="hl-btn hl-btn--sm" type="button" disabled tabIndex={-1}>대응 후보 승인</button>
      </div>
    </div>
  );
}
