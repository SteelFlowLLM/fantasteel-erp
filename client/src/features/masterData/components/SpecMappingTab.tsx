'use client';

// 규격 매핑 (REQ-MST-004): 슬래브 규격마다 대응 코일 규격 1개, 코일 1개 이론중량 ≤ 슬래브 1매 이론중량,
// 열연 계획 수율 = 코일 ÷ 슬래브 (저장하지 않고 계산). 매핑 수정은 없고, 쓰인 규격의 매핑은 지울 수 없다.
import { useState } from 'react';
import { masterDataApi, type MasterProductSpecView, type SpecBrief } from '@/api/masterData';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot, yieldPercentText } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterProductSpecs, useMasterSpecMappings, useMasterSteelGrades } from '@/hooks/useMasterData';
import { fmtDims, fmtTon } from '@/lib/format';
import { calcHotRollingYieldRate, compareDecimal } from '@/lib/weight';

function SpecCell({ spec }: { spec: SpecBrief }) {
  return (
    <span className="flex flex-col">
      <span className="font-mono text-mono">{spec.itemCode}</span>
      <span className="text-cap text-ink-3">{fmtDims(spec.thicknessMm, spec.widthMm, spec.lengthMm)} mm</span>
    </span>
  );
}

export function SpecMappingTab({ canEdit }: { canEdit: boolean }) {
  const mappings = useMasterSpecMappings();
  const [adding, setAdding] = useState(false);
  return (
    <Card>
      <CardHead
        title="슬래브 → 코일 규격 매핑"
        meta={mappings.data ? `${mappings.data.length}건 · 코일 1개 이론중량 ≤ 슬래브 1매 이론중량` : undefined}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setAdding(true)}>
            매핑 추가
          </Button>
        }
      />
      <QueryBoundary query={mappings} loadingLabel="규격 매핑을 불러오는 중…">
        {(rows) => (
          <>
            <div className="overflow-auto">
              <Table className="[&_td]:h-auto [&_td]:py-1.5">
                <thead>
                  <tr>
                    <Th>강종</Th>
                    <Th>슬래브 규격</Th>
                    <Th align="right">슬래브 1매</Th>
                    <Th>코일 규격</Th>
                    <Th align="right">코일 1개</Th>
                    <Th align="right">열연 계획 수율</Th>
                    <Th>사용 여부</Th>
                    <Th aria-label="삭제" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <Td>{m.steelGradeCode}</Td>
                      <Td>
                        <SpecCell spec={m.slab} />
                      </Td>
                      <Td align="right">{fmtTon(m.slab.theoreticalWeightTon)}</Td>
                      <Td>
                        <SpecCell spec={m.coil} />
                      </Td>
                      <Td align="right">{fmtTon(m.coil.theoreticalWeightTon)}</Td>
                      <Td align="right" className="font-semibold">
                        {yieldPercentText(m.hotRollingPlannedYieldRate)}
                      </Td>
                      <Td>{m.isUsed ? <Badge tone="run">사용됨</Badge> : <Badge>미사용</Badge>}</Td>
                      <Td align="right">
                        <RowActions
                          canEdit={canEdit}
                          remove={{
                            what: `${m.slab.itemCode} → ${m.coil.itemCode} 매핑`,
                            run: () => masterDataApi.deleteSpecMapping(m.id),
                            success: '매핑을 삭제했어요',
                            blockedReason: m.isUsed ? '수주·재고·LOT에 쓰인 규격' : null,
                          }}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rows.length === 0 ? <EmptyNote>매핑된 규격이 없어요</EmptyNote> : null}
            </div>
            <TableFoot>
              열연 계획 수율은 저장하지 않고 두 규격의 1매 이론중량으로 계산해요 · 같은 강종끼리, 아직 매핑되지 않은 규격만 매핑해요 · 수주·재고·LOT에 쓰인 규격의 매핑은 지울
              수 없어요
            </TableFoot>
          </>
        )}
      </QueryBoundary>
      {adding ? <SpecMappingModal onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}

function SpecMappingModal({ onClose }: { onClose: () => void }) {
  const specs = useMasterProductSpecs();
  const grades = useMasterSteelGrades();
  const fieldErrors = useMasterDataFieldErrors();
  const [gradeId, setGradeId] = useState('');
  const [slabId, setSlabId] = useState('');
  const [coilId, setCoilId] = useState('');
  const create = useAction(masterDataApi.createSpecMapping, { success: '규격을 매핑했어요', onSuccess: onClose, onError: fieldErrors.takeFrom });

  const all = specs.data ?? [];
  const byGrade = (s: MasterProductSpecView) => !gradeId || s.steelGradeId === Number(gradeId);
  const slabs = all.filter((s) => s.itemType === 'SLAB' && s.mappingId === null && byGrade(s));
  const slab = all.find((s) => s.id === Number(slabId));
  const coils = all.filter((s) => s.itemType === 'COIL' && s.mappingId === null && byGrade(s) && (!slab || s.steelGradeId === slab.steelGradeId));
  const coil = all.find((s) => s.id === Number(coilId));
  const tooHeavy = slab && coil ? compareDecimal(coil.theoreticalWeightTon, slab.theoreticalWeightTon) > 0 : false;
  const otherGrade = slab && coil ? slab.steelGradeId !== coil.steelGradeId : false;
  const rate = slab && coil && !tooHeavy ? calcHotRollingYieldRate(coil.theoreticalWeightTon, slab.theoreticalWeightTon) : null;

  return (
    <Modal
      title="규격 매핑 추가"
      onClose={onClose}
      width={560}
      footer={
        <ModalFooter
          pending={create.isPending}
          disabled={!slab || !coil || tooHeavy || otherGrade}
          submitLabel="매핑"
          onCancel={onClose}
          onSubmit={() => create.mutate({ slabItemId: slab?.id ?? null, coilItemId: coil?.id ?? null })}
        />
      }
    >
      <p className="text-sm text-ink-2">슬래브 규격마다 대응 코일 규격 1개를 정해요. 같은 강종끼리, 아직 매핑되지 않은 규격만 고를 수 있어요.</p>
      <Field label="강종">
        <Select
          value={gradeId}
          onChange={(e) => {
            setGradeId(e.target.value);
            setSlabId('');
            setCoilId('');
          }}
        >
          <option value="">전체 강종</option>
          {(grades.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.steelGradeCode}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="매핑 안 된 슬래브 규격" required error={fieldErrors.errorOf('slabItemId')} hint={slabs.length === 0 ? '고를 슬래브 규격이 없어요. 제품 규격 탭에서 먼저 추가해 주세요' : undefined}>
        <Select
          value={slabId}
          onChange={(e) => {
            setSlabId(e.target.value);
            setCoilId('');
            fieldErrors.clear();
          }}
        >
          <option value="">슬래브 규격을 선택해 주세요</option>
          {slabs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.itemCode} · {fmtTon(s.theoreticalWeightTon)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="매핑 안 된 코일 규격" required error={fieldErrors.errorOf('coilItemId')} hint={coils.length === 0 ? '고를 코일 규격이 없어요. 제품 규격 탭에서 먼저 추가해 주세요' : undefined}>
        <Select
          value={coilId}
          onChange={(e) => {
            setCoilId(e.target.value);
            fieldErrors.clear();
          }}
        >
          <option value="">코일 규격을 선택해 주세요</option>
          {coils.map((s) => (
            <option key={s.id} value={s.id}>
              {s.itemCode} · {fmtTon(s.theoreticalWeightTon)}
            </option>
          ))}
        </Select>
      </Field>
      {tooHeavy && slab && coil ? (
        <Banner tone="danger">
          코일 1개 이론중량({fmtTon(coil.theoreticalWeightTon)})이 슬래브 1매 이론중량({fmtTon(slab.theoreticalWeightTon)})보다 커서 매핑할 수 없어요
        </Banner>
      ) : null}
      {otherGrade ? <Banner tone="danger">강종이 다른 규격은 매핑할 수 없어요</Banner> : null}
      <div className="grid grid-cols-3 gap-3 rounded-md border border-line bg-surface-2 px-3.5 py-2.5 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="text-cap text-ink-3">슬래브 1매</span>
          <b className="font-semibold tabular-nums">{slab ? fmtTon(slab.theoreticalWeightTon) : '-'}</b>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-cap text-ink-3">코일 1개</span>
          <b className="font-semibold tabular-nums">{coil ? fmtTon(coil.theoreticalWeightTon) : '-'}</b>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-cap text-ink-3">열연 계획 수율</span>
          <b className="font-semibold tabular-nums">{rate ? `${rate} (${yieldPercentText(rate)})` : '-'}</b>
        </span>
      </div>
    </Modal>
  );
}
