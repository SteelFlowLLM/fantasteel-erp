// 기준정보 (REQ-MST-001~009, REQ-QC-002, BP-MST-01). 영역별 탭 + 상단 준비 상태 띠. 활성 탭은 ?tab= .
import { useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { Icon, QueryBoundary } from '@/components/ui';
import { canUse, useMe } from '@/stores/auth';
import { ConsumptionTab } from '@/features/master-data/ConsumptionTab';
import { InspectionTab } from '@/features/master-data/InspectionTab';
import { ItemMaterialTab } from '@/features/master-data/ItemMaterialTab';
import { useValidation } from '@/features/master-data/masterHooks';
import { PartyYardTab } from '@/features/master-data/PartyYardTab';
import { ProductSpecTab } from '@/features/master-data/ProductSpecTab';
import { ReadinessBanner, type MasterTabKey } from '@/features/master-data/ReadinessBanner';
import { RoutingTab } from '@/features/master-data/RoutingTab';
import { SettingsTab } from '@/features/master-data/SettingsTab';
import { SpecMappingTab } from '@/features/master-data/SpecMappingTab';
import { SteelGradeTab } from '@/features/master-data/SteelGradeTab';
import './MasterDataPage.css';

const TABS: { key: MasterTabKey; label: string; icon: string; sub: string }[] = [
  { key: 'specs', label: '제품 규격', icon: 'slab', sub: '슬래브·코일 규격과 1매 이론중량 (MST-003)' },
  { key: 'mapping', label: '규격 매핑', icon: 'link', sub: '슬래브 ↔ 코일 규격과 열연 계획 수율 (MST-004)' },
  { key: 'grades', label: '강종·성분', icon: 'check-circle', sub: '강종과 성분 규격 min·max (MST-002)' },
  { key: 'routing', label: '라우팅', icon: 'flow', sub: '품목 유형별 공정 순서와 계획 수율 (MST-005)' },
  { key: 'consumption', label: '배합 원단위', icon: 'calc', sub: '용선·용강 1t당 원료 투입량 (MST-006)' },
  { key: 'items', label: '품목·원료', icon: 'box', sub: '품목 단위 유형과 원료·기본 공급업체 (MST-001)' },
  { key: 'parties', label: '고객사·공급업체·야드', icon: 'building', sub: '고객사·공급업체·야드 등록 (MST-007·008)' },
  { key: 'inspection', label: '검사 항목', icon: 'quality', sub: '공정·강종별 검사 항목과 min·max (QC-002)' },
  { key: 'settings', label: '생산 설정', icon: 'gauge', sub: '히트 용량 · 납기 위험 기준일 (MST-009)' },
];

export function MasterDataPage() {
  const me = useMe();
  const canEdit = canUse(me, 'MASTER_MANAGE');
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: MasterTabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as MasterTabKey) : 'specs';
  const setTab = (t: MasterTabKey) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('sub'); return n; }, { replace: true });
  const validation = useValidation();

  // 기준정보 관리 권한이 전혀 없으면 서버가 403을 준다 → 권한 없음 상태로 보여준다.
  if (validation.error instanceof ApiError && validation.error.status === 403) {
    return <main className="hl-main"><QueryBoundary query={validation}>{() => null}</QueryBoundary></main>;
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const goMapping = () => setTab('mapping');
  return (
    <main className="hl-main" style={{ minWidth: 0 }}>
      <div className="hl-row" style={{ gap: 12, flex: 'none' }}>
        <div className="hl-col">
          <h1 className="hl-title">기준정보</h1>
          <span className="hl-cap">{current.sub}</span>
        </div>
      </div>
      <ReadinessBanner goTab={setTab} />
      <div className="hl-tabs md-tabs" role="tablist" aria-label="기준정보 영역">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`hl-tab${tab === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size="sm" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="md-body">
        {tab === 'specs' ? <ProductSpecTab canEdit={canEdit} goMapping={goMapping} /> : null}
        {tab === 'mapping' ? <SpecMappingTab canEdit={canEdit} /> : null}
        {tab === 'grades' ? <SteelGradeTab canEdit={canEdit} /> : null}
        {tab === 'routing' ? <RoutingTab canEdit={canEdit} goMapping={goMapping} /> : null}
        {tab === 'consumption' ? <ConsumptionTab canEdit={canEdit} /> : null}
        {tab === 'items' ? <ItemMaterialTab canEdit={canEdit} /> : null}
        {tab === 'parties' ? <PartyYardTab canEdit={canEdit} /> : null}
        {tab === 'inspection' ? <InspectionTab canEdit={canEdit} /> : null}
        {tab === 'settings' ? <SettingsTab canEdit={canEdit} /> : null}
      </div>
    </main>
  );
}
