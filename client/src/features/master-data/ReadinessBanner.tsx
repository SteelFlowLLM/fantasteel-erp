// 기준정보 준비 상태 (MST-001): GET /master-data/validation — 계산을 막는 누락·오류를 한 줄 띠로 보여준다.
import { useState } from 'react';
import type { MasterArea } from '@/api/masterData';
import { Icon } from '@/components/ui';
import { fmtHM } from '@/lib/format';
import { useValidation } from './masterHooks';

export type MasterTabKey = 'specs' | 'mapping' | 'grades' | 'routing' | 'consumption' | 'items' | 'parties' | 'inspection' | 'settings';

const AREA: Record<MasterArea, { label: string; tab: MasterTabKey }> = {
  PRODUCT_SPEC: { label: '제품 규격', tab: 'specs' },
  SPEC_MAPPING: { label: '규격 매핑', tab: 'mapping' },
  ROUTING: { label: '라우팅', tab: 'routing' },
  SPECIFIC_CONSUMPTION: { label: '배합 원단위', tab: 'consumption' },
  RAW_MATERIAL: { label: '원료', tab: 'items' },
  STEEL_GRADE: { label: '강종·성분', tab: 'grades' },
  INSPECTION_ITEM: { label: '검사 항목', tab: 'inspection' },
  PRODUCTION_SETTING: { label: '생산 설정', tab: 'settings' },
};
const FOLD = 3;

export function ReadinessBanner({ goTab }: { goTab: (t: MasterTabKey) => void }) {
  const q = useValidation();
  const [open, setOpen] = useState(false);
  const v = q.data;

  if (!v) {
    if (q.error) return <div className="hl-banner hl-banner--wait" style={{ flex: 'none' }}><Icon name="alert" /><div>준비 상태를 확인하지 못했어요. <button type="button" className="hl-link-id" style={{ background: 'none', border: 0, cursor: 'pointer' }} onClick={() => void q.refetch()}>다시 시도</button></div></div>;
    return <div className="hl-banner" style={{ flex: 'none' }}><Icon name="refresh" />준비 상태를 확인하는 중이에요…</div>;
  }
  const refresh = (
    <div className="hl-banner__actions">
      <span className="hl-cap">{fmtHM(v.checkedAt)} 확인</span>
      <button type="button" className="hl-btn hl-btn--sm" onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="준비 상태 다시 확인"><Icon name="refresh" />다시 확인</button>
    </div>
  );
  if (v.ready) {
    return (
      <div className="hl-banner hl-banner--ok" style={{ flex: 'none', alignItems: 'center' }} role="status">
        <Icon name="check-circle" style={{ marginTop: 0 }} />
        <div><b>기준정보 준비 완료</b> <span style={{ opacity: 0.8 }}>· 생산·MRP 계산에 필요한 기준정보가 모두 있어요</span></div>
        {refresh}
      </div>
    );
  }
  const shown = open ? v.problems : v.problems.slice(0, FOLD);
  return (
    <div className="hl-banner hl-banner--danger" style={{ flex: 'none' }} role="alert">
      <Icon name="alert" />
      <div className="hl-col" style={{ gap: 4, flex: 1 }}>
        <div><b>기준정보 준비가 덜 됐어요 ({v.problemCount}건)</b> <span style={{ opacity: 0.8 }}>· 아래를 채워야 생산·MRP 계산이 돼요</span></div>
        <ul className="md-problems">
          {shown.map((p, i) => (
            <li key={`${p.area}-${p.targetNo}-${i}`}>
              <button type="button" className="md-problem-area" onClick={() => goTab(AREA[p.area].tab)} title={`${AREA[p.area].label} 탭으로 이동`}>{AREA[p.area].label}</button>
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
        {v.problems.length > FOLD ? <button type="button" className="hl-link-id md-more" onClick={() => setOpen(!open)}>{open ? '접기' : `${v.problems.length - FOLD}건 더 보기`}</button> : null}
      </div>
      {refresh}
    </div>
  );
}
