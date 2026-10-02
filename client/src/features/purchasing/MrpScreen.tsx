'use client';

// MRP (REQ-PRD-005, BP-PRD-01, 업무 프로세스 4.4): 기간을 정하면 지금 데이터로 바로 계산한다(실행 이력 저장 없음, PLAN 7장).
// 계획별 남은 히트 → 히트 톤 → 필요 용선(÷ 제강 수율) → 철광석·석탄·석회석(× t/t), 합금철(히트 톤 × kg/t ÷ 1,000)
// → 총소요 − 원료 LOT 잔량 − 입고예정(필요일까지 도착하는 확정 발주) = 순소요. 예상 슬래브 여재도 보인다(여재는 가용재고에 포함).
// 원료 줄의 입고예정 칸은 이 계획들이 실제로 받아 쓰는 몫만 보이고, 뺀 몫(다른 계획 몫·필요일 뒤 도착 등)은 칸 아래 작은 글씨로 보여
// 한 줄의 숫자끼리 산수가 맞는다(core mrpMaterialRows).
// "구매요청 만들기"는 순소요 줄(계획·원료)로 미리 채우고 production_plan_id를 연결한다. 같은 계획·원료는 한 번만 만든다.
// 구매요청 자동 초안(REQ-PUR-005)은 P2라 준비 중이다.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PERMISSION, RAW_MATERIAL_TYPE_LABEL } from '@/codes';
import { InputError } from '@/api/client';
import type { MrpPeriod, MrpRequisitionLine, MrpView } from '@/api/mrp';
import { Badge } from '@/components/Badge';
import { Button, ButtonLink } from '@/components/Button';
import { Card, CardBody, CardFoot, CardHead } from '@/components/Card';
import { SoonButton } from '@/components/ComingSoon';
import { DateInput } from '@/components/DateInput';
import { Kpi, StatBar } from '@/components/Kpi';
import { PageHead, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Segmented } from '@/components/Tabs';
import { PlanStatusBadge } from '@/features/purchasing/components/PurchasingParts';
import { RequisitionFormModal, type RequisitionFormValues } from '@/features/purchasing/components/RequisitionFormModal';
import { defaultMrpPeriod, mrpOnHandNotes, mrpRequestReason, mrpScheduledReceiptNotes, trimTonText } from '@/features/purchasing/lib/purchasingView';
import { useMrpRequirements } from '@/hooks/useMrp';
import { useCanUse, useCanView } from '@/hooks/usePermission';
import { decCmp, decSum } from '@/lib/decimal';
import { fmtDate, fmtInt, fmtNum, fmtTon, todayStr } from '@/lib/format';
import { permissionNeedText } from '@/lib/permissions';
import { cn } from '@/lib/cn';

type MaterialFilter = 'all' | 'net';

interface RequisitionDraft {
  values: RequisitionFormValues;
  line: MrpRequisitionLine;
}

export function MrpScreen() {
  const today = todayStr();
  const [period, setPeriod] = useState<MrpPeriod>(() => defaultMrpPeriod(today));
  const [filter, setFilter] = useState<MaterialFilter>('all');
  const [draft, setDraft] = useState<RequisitionDraft | null>(null);
  const canCreate = useCanUse(PERMISSION.PURCHASE_REQUISITION_CREATE);
  const canSeeRequisitions = useCanView(PERMISSION.PURCHASE_REQUISITION_CREATE, PERMISSION.PURCHASE_ORDER_CONFIRM);
  const query = useMrpRequirements(period);
  const periodErrors = query.error instanceof InputError ? query.error.fieldErrors : {};

  const openRequisition = (line: MrpRequisitionLine) =>
    setDraft({
      line,
      values: {
        desiredReceiptDate: line.needDate >= today ? line.needDate : '',
        requestReason: mrpRequestReason(line, period),
        items: [{ itemId: line.itemId, requiredTon: trimTonText(line.netTon), productionPlanId: line.productionPlanId, productionPlanNo: line.productionPlanNo }],
      },
    });

  return (
    <PageMain>
      <PageHead
        title="MRP"
        actions={
          <>
            <SoonButton grade="P2" size="sm">
              구매요청 자동 초안
            </SoonButton>
            {canSeeRequisitions ? (
              <ButtonLink href="/purchase-requisitions" size="sm" icon="cart">
                구매요청 목록
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Card>
        <CardBody className="flex-row flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
            필요일 기간 시작
            <DateInput value={period.from} onChange={(value) => value && setPeriod((current) => ({ ...current, from: value }))} invalid={Boolean(periodErrors.from)} ariaLabel="필요일 기간 시작" />
          </label>
          <span className="pb-2 text-ink-3">~</span>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-2">
            필요일 기간 끝
            <DateInput value={period.to} onChange={(value) => value && setPeriod((current) => ({ ...current, to: value }))} invalid={Boolean(periodErrors.to)} ariaLabel="필요일 기간 끝" />
          </label>
          <Button size="sm" className="mb-0.5" onClick={() => setPeriod(defaultMrpPeriod(today))}>
            기본 기간
          </Button>
          <span className="mb-1.5 ml-auto max-w-[460px] text-cap leading-4 text-ink-3">
            필요일(연결 수주 품목 납기, 수주 연결이 없으면 계획 등록일)이 기간 안에 있는 계획·진행중 생산계획의 남은 히트로 계산해요. 원료 LOT 잔량·입고예정은 필요일이 앞선 계획부터 쓰므로, 시작일 전에 필요한 밀린 계획도 &apos;기간 전&apos;으로 함께 보여요. 결과는 저장하지 않고, 잔량·입고예정은 지금 값이에요.
          </span>
          {canCreate ? null : <ReadOnlyHint permissions={[PERMISSION.PURCHASE_REQUISITION_CREATE]} className="w-full" />}
        </CardBody>
      </Card>

      <QueryBoundary query={query} loadingLabel="MRP를 계산하는 중…">
        {(mrp) => <MrpResult mrp={mrp} filter={filter} onFilter={setFilter} canCreate={canCreate} onCreate={openRequisition} />}
      </QueryBoundary>

      <p className="text-cap leading-4 text-ink-3">
        계산 방법 · 필요 용선 = 히트 톤 ÷ 제강 수율 · 철광석·석탄·석회석 = 필요 용선 × 원단위(t/t) · 합금철 = 히트 톤 × 원단위(kg/t) ÷ 1,000 · 순소요 = 총소요 − 원료 LOT 잔량 − 입고예정 (0보다 작으면 0). 잔량·입고예정은
        필요일이 이른 계획부터 한 번만 빼고, 계획에 연결된 발주의 입고예정은 그 계획이 먼저 써요. 입고예정은 필요일까지 도착하는 몫만 쓰고 수주에 연결된 다른 계획 몫은 쓰지 않으므로, 표의 입고예정 칸은 이
        계획들이 실제로 쓰는 몫이고 뺀 몫은 이유와 함께 칸 아래에 보여요. MRP는 구매요청을 저절로 만들지 않아요. 구매 담당이 등록하고 부서장이 승인해요.
      </p>

      {draft ? (
        <RequisitionFormModal
          mode="create"
          initial={draft.values}
          notice={`MRP 순소요로 채웠어요 (${draft.line.productionPlanNo} · ${draft.line.itemName} ${fmtTon(draft.line.netTon)} · 필요일 ${fmtDate(draft.line.needDate)}). 수량과 희망 입고일을 확인한 뒤 등록해 주세요. 근거 생산계획이 함께 연결돼요.`}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </PageMain>
  );
}

function MrpResult({
  mrp,
  filter,
  onFilter,
  canCreate,
  onCreate,
}: {
  mrp: MrpView;
  filter: MaterialFilter;
  onFilter: (value: MaterialFilter) => void;
  canCreate: boolean;
  onCreate: (line: MrpRequisitionLine) => void;
}) {
  const shortMaterials = mrp.materials.filter((m) => decCmp(m.netTon, 0) > 0);
  const materials = filter === 'net' ? shortMaterials : mrp.materials;
  const totalHeats = mrp.plans.reduce((sum, p) => sum + p.remainingHeatCount, 0);
  const totalHeatTon = decSum(mrp.plans.map((p) => p.heatTon));
  const totalHotMetal = decSum(mrp.plans.map((p) => p.requiredHotMetalTon));
  const totalSurplus = mrp.plans.reduce((sum, p) => sum + p.expectedSurplusSlabQty, 0);
  const openLines = mrp.requisitionLines.filter((l) => l.existingPurchaseRequisitionNo === null);
  const linesByMaterial = useMemo(() => {
    const map = new Map<number, MrpRequisitionLine[]>();
    for (const line of mrp.requisitionLines) map.set(line.itemId, [...(map.get(line.itemId) ?? []), line]);
    return map;
  }, [mrp.requisitionLines]);

  return (
    <>
      <StatBar>
        <Kpi flat label="남은 히트" value={fmtInt(totalHeats)} unit="히트" sub={`생산계획 ${mrp.plans.length}건 · 히트 용량 ${fmtTon(mrp.heatCapacityTon)}`} />
        <Kpi flat label="히트 톤" value={fmtNum(totalHeatTon, 3)} unit="t" sub="합금철 소요의 기준" />
        <Kpi flat label="필요 용선" value={fmtNum(totalHotMetal, 3)} unit="t" sub="히트 톤 ÷ 제강 수율" />
        <Kpi
          flat
          label="순소요 원료"
          value={fmtInt(shortMaterials.length)}
          unit="종"
          sub={shortMaterials.length > 0 ? shortMaterials.map((m) => `${m.itemName} ${fmtTon(m.netTon)}`).join(' · ') : '모든 원료가 잔량·입고예정으로 충분해요'}
        />
        <Kpi flat label="예상 슬래브 여재" value={fmtInt(totalSurplus)} unit="매" sub="히트 단위 생산으로 수주보다 더 나오는 슬래브 (가용재고에 포함)" />
      </StatBar>

      <Card>
        <CardHead
          title="원료·합금철 소요량"
          meta={`${mrp.from} ~ ${mrp.to}`}
          actions={
            <Segmented<MaterialFilter>
              ariaLabel="원료 보기"
              items={[
                { key: 'all', label: `전체 ${mrp.materials.length}` },
                { key: 'net', label: `순소요만 ${shortMaterials.length}` },
              ]}
              active={filter}
              onChange={onFilter}
            />
          }
        />
        <CardBody flush>
          {materials.length === 0 ? (
            <EmptyNote>{filter === 'net' ? '이 기간에 순소요가 있는 원료가 없어요' : '계산된 원료가 없어요'}</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>원료코드</Th>
                  <Th>원료명</Th>
                  <Th>원료 유형</Th>
                  <Th align="right">총소요</Th>
                  <Th align="right" title="지금 원료 LOT 잔량 합계. 필요일이 이른 계획부터 써요">
                    원료 LOT 잔량
                  </Th>
                  <Th align="right" title="확정 발주의 미입고량 중 이 계획들이 필요일까지 받아 쓰는 몫. 다른 계획 몫·필요일 뒤 도착분은 아래 작은 글씨로 따로 보여요">
                    입고예정
                  </Th>
                  <Th align="right">순소요</Th>
                  <Th>필요일</Th>
                  <Th>구매요청</Th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => {
                  const isShort = decCmp(m.netTon, 0) > 0;
                  const lines = linesByMaterial.get(m.itemId) ?? [];
                  const requested = lines.filter((l) => l.existingPurchaseRequisitionNo !== null);
                  return (
                    <tr key={m.itemId} data-risk={isShort}>
                      <Td className="font-mono">{m.itemCode}</Td>
                      <Td>{m.itemName}</Td>
                      <Td className="text-ink-2">
                        {m.rawMaterialType ? RAW_MATERIAL_TYPE_LABEL[m.rawMaterialType] : '-'} <span className="text-cap text-ink-3">({m.consumptionUnit})</span>
                      </Td>
                      <Td align="right">{fmtTon(m.grossTon)}</Td>
                      <Td align="right" title={`원료 LOT 잔량 합계 ${fmtTon(m.onHandTon)} · 소요에 쓴 잔량 ${fmtTon(m.coveredOnHandTon)}`}>
                        {fmtTon(m.usableOnHandTon)}
                        <SupplyNotes notes={mrpOnHandNotes(m)} />
                      </Td>
                      <Td align="right" title={`입고예정 합계 ${fmtTon(m.scheduledReceiptTon)} 중 이 계획들이 필요일까지 받아 쓰는 몫 ${fmtTon(m.coveredScheduledTon)}`}>
                        {fmtTon(m.coveredScheduledTon)}
                        <SupplyNotes notes={mrpScheduledReceiptNotes(m)} />
                      </Td>
                      <Td align="right" className={cn(isShort ? 'font-semibold text-danger' : 'text-ink-3')}>
                        {fmtTon(m.netTon)}
                      </Td>
                      <Td>{m.firstShortageDate ? fmtDate(m.firstShortageDate) : '-'}</Td>
                      <Td>
                        {!isShort ? (
                          <Badge tone="ok">충분</Badge>
                        ) : requested.length === lines.length ? (
                          <Badge tone="run">요청함 · {requested.map((l) => l.existingPurchaseRequisitionNo).join(', ')}</Badge>
                        ) : (
                          <span className="text-cap text-ink-3">아래 계획별 줄에서 만들어요 ({lines.length - requested.length}줄)</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
        <CardFoot>
          <span className="text-cap text-ink-3">
            입고예정 칸 = 확정 발주의 미입고량(발주 − 입고 누계) 중 이 계획들이 필요일까지 받아 쓰는 몫 (다른 계획 몫·필요일 뒤 도착분은 칸 아래에 따로) · 용선 재고는 빼지 않아요 · 아직 요청하지 않은 순소요{' '}
            {openLines.length}줄
          </span>
        </CardFoot>
      </Card>

      <Card>
        <CardHead title="구매요청 만들 순소요" meta="계획·원료마다 한 번만 만들어요" />
        <CardBody flush>
          {mrp.requisitionLines.length === 0 ? (
            <EmptyNote>순소요가 없어 구매요청을 만들 줄이 없어요</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>생산계획</Th>
                  <Th>원료</Th>
                  <Th align="right">순소요</Th>
                  <Th>필요일</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {mrp.requisitionLines.map((line) => (
                  <tr key={`${line.productionPlanId}-${line.itemId}`} data-muted={line.existingPurchaseRequisitionNo !== null}>
                    <Td className="font-mono">{line.productionPlanNo}</Td>
                    <Td>
                      {line.itemName} <span className="font-mono text-cap text-ink-3">{line.itemCode}</span>
                    </Td>
                    <Td align="right" className="font-semibold">
                      {fmtTon(line.netTon)}
                    </Td>
                    <Td>
                      {fmtDate(line.needDate)}
                      {line.needDate < mrp.from ? <BeforePeriodBadge /> : null}
                    </Td>
                    <Td align="right">
                      {line.existingPurchaseRequisitionNo ? (
                        <span className="text-cap text-ink-3">이미 요청했어요 · {line.existingPurchaseRequisitionNo}</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          icon="plus"
                          disabled={!canCreate}
                          title={canCreate ? undefined : permissionNeedText([PERMISSION.PURCHASE_REQUISITION_CREATE])}
                          onClick={() => onCreate(line)}
                        >
                          구매요청 만들기
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="근거 생산계획"
          meta={`${mrp.plans.length}건`}
          actions={
            <Link href="/production/plans" className="text-xs text-run hover:underline">
              생산계획 &gt;
            </Link>
          }
        />
        <CardBody flush>
          {mrp.plans.length === 0 ? (
            <EmptyNote>이 기간에 남은 히트가 있는 생산계획이 없어요</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>계획번호</Th>
                  <Th>상태</Th>
                  <Th>강종 · 규격</Th>
                  <Th>수주</Th>
                  <Th>필요일</Th>
                  <Th align="right">남은 히트</Th>
                  <Th align="right">히트 톤</Th>
                  <Th align="right">필요 용선</Th>
                  <Th align="right">예상 슬래브 여재</Th>
                  <Th>순소요</Th>
                </tr>
              </thead>
              <tbody>
                {mrp.plans.map((plan) => {
                  const short = plan.materials.filter((m) => decCmp(m.netTon, 0) > 0);
                  return (
                    <tr key={plan.productionPlanId}>
                      <Td className="font-mono">{plan.productionPlanNo}</Td>
                      <Td>
                        <PlanStatusBadge status={plan.productionPlanStatus} />
                      </Td>
                      <Td>
                        {plan.steelGradeCode ?? '-'} · {plan.itemName}
                      </Td>
                      <Td className="font-mono">{plan.salesOrderNo ?? <span className="font-sans text-ink-3">연결 없음</span>}</Td>
                      <Td>
                        {fmtDate(plan.needDate)}
                        {plan.beforePeriod ? <BeforePeriodBadge /> : null}
                      </Td>
                      <Td align="right">{fmtInt(plan.remainingHeatCount)}</Td>
                      <Td align="right">{fmtTon(plan.heatTon)}</Td>
                      <Td align="right">{fmtTon(plan.requiredHotMetalTon)}</Td>
                      <Td align="right">{fmtInt(plan.expectedSurplusSlabQty)}매</Td>
                      <Td className="text-cap">
                        {short.length === 0 ? <span className="text-ink-3">없음</span> : short.map((m) => `${m.itemCode} ${fmtTon(m.netTon)}`).join(' · ')}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td>합계</Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td align="right">{fmtInt(totalHeats)}</Td>
                  <Td align="right">{fmtTon(totalHeatTon)}</Td>
                  <Td align="right">{fmtTon(totalHotMetal)}</Td>
                  <Td align="right">{fmtInt(totalSurplus)}매</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/** 칸의 숫자에 넣지 않은 몫 (이유별 작은 글씨, 없으면 그리지 않음) */
function SupplyNotes({ notes }: { notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <>
      {notes.map((note) => (
        <span key={note} className="block text-cap leading-4 text-ink-3">
          {note}
        </span>
      ))}
    </>
  );
}

/** 필요일이 기간 시작 전인 미생산 계획(밀린 소요): 기간 안 계획보다 먼저 잔량·입고예정을 쓴다 */
function BeforePeriodBadge() {
  return (
    <Badge tone="wait" className="ml-1.5" title="필요일이 기간 시작 전인데 아직 남은 히트가 있는 계획이에요. 기간 안 계획보다 먼저 원료 LOT 잔량·입고예정을 써요">
      기간 전
    </Badge>
  );
}
