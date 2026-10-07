'use client';

// 품목 (REQ-MST-001·007·008): 원료·슬래브·코일을 한 테이블(item)에서 품목 유형으로 나눈다(TRM-011).
// - 원료: 원료 코드(영문 3자 + 숫자 2자리, 품목 코드), 원료 유형, 단위 유형 톤, 기본 공급업체 1곳, 기본 야드(원료 야드)
// - 제품 품목(슬래브·코일): 품목 코드 = 규격 코드, 단위 유형 매수, 기본 야드. 공급업체는 지정하지 않는다(TRM-029). 추가·수정은 제품 규격 탭에서.
import { useState } from 'react';
import { ITEM_TYPE_LABEL, RAW_MATERIAL_TYPE, RAW_MATERIAL_TYPE_LABEL, UNIT_TYPE_LABEL, type RawMaterialType } from '@/codes';
import { isMasterServerMode, masterDataApi, type MasterRawMaterialView } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot, type MasterTabKey } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterProductSpecs, useMasterRawMaterials, useMasterSuppliers, useMasterYards } from '@/hooks/useMasterData';

export function ItemTab({ canEdit, onGoTab }: { canEdit: boolean; onGoTab: (tab: MasterTabKey) => void }) {
  return (
    <>
      <RawMaterialCard canEdit={canEdit} />
      <ProductItemCard onGoTab={onGoTab} />
    </>
  );
}

function RawMaterialCard({ canEdit }: { canEdit: boolean }) {
  const materials = useMasterRawMaterials();
  const [typeFilter, setTypeFilter] = useState('');
  const [editing, setEditing] = useState<MasterRawMaterialView | 'new' | null>(null);
  return (
    <Card>
      <CardHead
        title="원료"
        meta={materials.data ? `${materials.data.length}개 · 원료 코드는 LOT 번호(RM-원료코드-…)에 쓰여요` : undefined}
        actions={
          <>
            <Select aria-label="원료 유형" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-32">
              <option value="">원료 유형 전체</option>
              {Object.values(RAW_MATERIAL_TYPE).map((t) => (
                <option key={t} value={t}>
                  {RAW_MATERIAL_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setEditing('new')}>
              원료 추가
            </Button>
          </>
        }
      />
      <QueryBoundary query={materials} loadingLabel="원료를 불러오는 중…">
        {(rows) => {
          const shown = rows.filter((m) => !typeFilter || m.rawMaterialType === typeFilter);
          return (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>원료 코드</Th>
                    <Th>원료명</Th>
                    <Th>원료 유형</Th>
                    <Th>단위 유형</Th>
                    <Th>기본 공급업체</Th>
                    <Th>기본 야드</Th>
                    <Th aria-label="수정·삭제" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.id}>
                      <Td className="font-mono text-mono">{m.itemCode}</Td>
                      <Td>{m.itemName}</Td>
                      <Td>{RAW_MATERIAL_TYPE_LABEL[m.rawMaterialType]}</Td>
                      <Td>{UNIT_TYPE_LABEL[m.unitType]}</Td>
                      <Td>{m.defaultSupplierName ?? <span className="text-cap font-semibold text-danger">없음</span>}</Td>
                      <Td>{m.defaultYardName}</Td>
                      <Td align="right">
                        <RowActions
                          canEdit={canEdit}
                          onEdit={() => setEditing(m)}
                          remove={{ what: `원료 ${m.itemCode}`, run: () => masterDataApi.deleteRawMaterial(m.id), success: '원료를 삭제했어요', blockedReason: m.referenceText }}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {shown.length === 0 ? <EmptyNote>조건에 맞는 원료가 없어요</EmptyNote> : null}
              <TableFoot>
                원료 코드·원료 유형은 만든 뒤 바꿀 수 없어요{isMasterServerMode() ? '' : ' · 기본 공급업체를 비우면 준비 상태에 누락으로 나와요'} · 원료 재고는 원료 LOT 잔량 합계라 재고 화면에서 봐요
              </TableFoot>
            </>
          );
        }}
      </QueryBoundary>
      {editing ? <RawMaterialModal material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function RawMaterialModal({ material, onClose }: { material: MasterRawMaterialView | null; onClose: () => void }) {
  const suppliers = useMasterSuppliers();
  const yards = useMasterYards();
  const fieldErrors = useMasterDataFieldErrors();
  const [itemCode, setItemCode] = useState(material?.itemCode ?? '');
  const [itemName, setItemName] = useState(material?.itemName ?? '');
  const [rawMaterialType, setRawMaterialType] = useState<RawMaterialType | ''>(material?.rawMaterialType ?? '');
  const [supplierId, setSupplierId] = useState(material?.defaultSupplierId ? String(material.defaultSupplierId) : '');
  const [yardId, setYardId] = useState(material ? String(material.defaultYardId) : '');
  const options = { onSuccess: onClose, onError: fieldErrors.takeFrom };
  const create = useAction(masterDataApi.createRawMaterial, { ...options, success: '원료를 추가했어요' });
  const update = useAction(masterDataApi.updateRawMaterial, { ...options, success: '원료를 저장했어요' });
  const rawYards = (yards.data ?? []).filter((y) => y.yardType === 'RAW_MATERIAL');

  const submit = () => {
    const common = { itemName, defaultYardId: yardId ? Number(yardId) : null, defaultSupplierId: supplierId ? Number(supplierId) : null };
    if (material) update.mutate({ ...common, id: material.id, expectedUpdatedAt: material.updatedAt });
    else create.mutate({ ...common, itemCode, rawMaterialType: rawMaterialType || null });
  };

  return (
    <Modal
      title={material ? `원료 수정 · ${material.itemCode}` : '원료 추가'}
      onClose={onClose}
      width={480}
      footer={<ModalFooter pending={create.isPending || update.isPending} submitLabel={material ? '저장' : '추가'} onCancel={onClose} onSubmit={submit} />}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="원료 코드" required hint={material ? '만든 뒤에는 바꿀 수 없어요' : '영문 대문자 3자 + 숫자 2자리 (예: ORE01)'} error={fieldErrors.errorOf('itemCode')}>
          <Input
            value={itemCode}
            readOnly={material !== null}
            maxLength={5}
            placeholder="ORE02"
            className="font-mono"
            invalid={fieldErrors.errorOf('itemCode') !== null}
            onChange={(e) => {
              setItemCode(e.target.value.toUpperCase());
              fieldErrors.clear('itemCode');
            }}
          />
        </Field>
        <Field label="원료 유형" required hint={material ? '만든 뒤에는 바꿀 수 없어요' : '합금철은 용강 1t당 kg, 그 밖은 용선 1t당 t로 원단위를 넣어요'} error={fieldErrors.errorOf('rawMaterialType')}>
          <Select
            value={rawMaterialType}
            disabled={material !== null}
            invalid={fieldErrors.errorOf('rawMaterialType') !== null}
            onChange={(e) => {
              const next = Object.values(RAW_MATERIAL_TYPE).find((t) => t === e.target.value);
              setRawMaterialType(next ?? '');
              fieldErrors.clear('rawMaterialType');
            }}
          >
            <option value="">원료 유형을 선택해 주세요</option>
            {Object.values(RAW_MATERIAL_TYPE).map((t) => (
              <option key={t} value={t}>
                {RAW_MATERIAL_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="원료명" required error={fieldErrors.errorOf('itemName')}>
        <Input
          value={itemName}
          maxLength={100}
          invalid={fieldErrors.errorOf('itemName') !== null}
          onChange={(e) => {
            setItemName(e.target.value);
            fieldErrors.clear('itemName');
          }}
        />
      </Field>
      {/* 준비 상태는 서버 API가 없어 서버 모드에서 안내하지 않는다 */}
      <Field label="기본 공급업체" hint={isMasterServerMode() ? '품목별 1곳' : '품목별 1곳. 비우면 준비 상태에 누락으로 나와요'}>
        <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">지정 안 함</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.supplierName} ({s.supplierCode})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="기본 야드" required hint="입고로 원료 LOT이 생기면 이 야드로 자동 지정돼요" error={fieldErrors.errorOf('defaultYardId')}>
        <Select
          value={yardId}
          invalid={fieldErrors.errorOf('defaultYardId') !== null}
          onChange={(e) => {
            setYardId(e.target.value);
            fieldErrors.clear('defaultYardId');
          }}
        >
          <option value="">기본 야드를 선택해 주세요</option>
          {rawYards.map((y) => (
            <option key={y.id} value={y.id}>
              {y.yardName} ({y.yardCode})
            </option>
          ))}
        </Select>
      </Field>
      {material ? null : <p className="text-cap text-ink-3">단위 유형은 톤이에요. 원료 재고는 입고 확정 때 생기는 원료 LOT로 관리해요.</p>}
    </Modal>
  );
}

function ProductItemCard({ onGoTab }: { onGoTab: (tab: MasterTabKey) => void }) {
  const specs = useMasterProductSpecs();
  return (
    <Card>
      <CardHead
        title="제품 품목 (슬래브·코일)"
        meta={specs.data ? `${specs.data.length}개 · 품목 코드 = 규격 코드` : undefined}
        actions={
          <Button size="sm" icon="arrow-right" onClick={() => onGoTab('specs')}>
            제품 규격 탭에서 관리
          </Button>
        }
      />
      <QueryBoundary query={specs} loadingLabel="제품 품목을 불러오는 중…">
        {(rows) => (
          <>
            <div className="max-h-[360px] overflow-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>품목 코드</Th>
                    <Th>품목명</Th>
                    <Th>품목 유형</Th>
                    <Th>단위 유형</Th>
                    <Th>기본 야드</Th>
                    <Th>기본 공급업체</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-mono text-mono">{s.itemCode}</Td>
                      <Td>{s.itemName}</Td>
                      <Td>{ITEM_TYPE_LABEL[s.itemType]}</Td>
                      <Td>{UNIT_TYPE_LABEL[s.unitType]}</Td>
                      <Td>{s.defaultYardName}</Td>
                      <Td className="text-ink-3">지정하지 않음</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rows.length === 0 ? <EmptyNote>제품 품목이 없어요</EmptyNote> : null}
            </div>
            <TableFoot>제품 품목은 제품 규격 탭에서 추가·수정해요 · 공급업체는 원료에만 지정해요 · 단위 유형: 제품은 매수, 원료는 톤</TableFoot>
          </>
        )}
      </QueryBoundary>
    </Card>
  );
}
