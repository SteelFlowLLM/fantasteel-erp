'use client';

// 강종 (REQ-MST-002): 강종 코드·이름·적용 규격 번호(TRM-113, 밀시트에 표시).
// 성분 규격(C·Si·Mn·P·S …)은 여기서 고치지 않는다. 제강 검사 기준의 항목이 곧 성분 규격이다(TRM-020) → 품질의 검사 기준으로 연결한다.
import Link from 'next/link';
import { useState } from 'react';
import { masterDataApi, type MasterSteelGradeView } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { CODE_LINK, MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot, useMasterDelete } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterSteelGrades } from '@/hooks/useMasterData';

const buildSteelmakingHref = (steelGradeId: number) => `/quality/standards?process=STEELMAKING&grade=${steelGradeId}`;

export function SteelGradeTab({ canEdit }: { canEdit: boolean }) {
  const grades = useMasterSteelGrades();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MasterSteelGradeView | null>(null);
  const deletion = useMasterDelete();
  return (
    <Card petKey="card:masterData.grades">
      <CardHead
        title="강종"
        meta={grades.data ? `${grades.data.length}종` : undefined}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setAdding(true)}>
            강종 추가
          </Button>
        }
      />
      <QueryBoundary query={grades} loadingLabel="강종을 불러오는 중…">
        {(rows) => (
          <>
            <div className="overflow-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>강종 코드</Th>
                    <Th>강종 이름</Th>
                    <Th>적용 규격</Th>
                    <Th align="right">제품 규격</Th>
                    <Th>성분 규격 (제강 검사 기준)</Th>
                    <Th aria-label="수정·삭제" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((g) => (
                    <tr key={g.id} data-pet-item="steelGrade" data-pet-item-title={g.steelGradeCode}>
                      <Td className="font-semibold">{g.steelGradeCode}</Td>
                      <Td>{g.steelGradeName}</Td>
                      <Td>{g.standardNo ?? <span className="text-ink-3">적용 규격 번호 없음</span>}</Td>
                      <Td align="right">{g.specCount === 0 ? <span className="text-ink-3">없음</span> : `${g.specCount}개`}</Td>
                      <Td>
                        {g.steelmakingStandard ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Link href={buildSteelmakingHref(g.id)} className={CODE_LINK}>
                              {g.steelmakingStandard.inspectionStandardCode}
                            </Link>
                            <Tag size="sm">v{g.steelmakingStandard.version}</Tag>
                            <span className="text-cap text-ink-3">항목 {g.steelmakingStandard.itemCount}개</span>
                          </span>
                        ) : (
                          <Link href={buildSteelmakingHref(g.id)} className="text-cap font-semibold text-danger hover:underline">
                            제강 검사 기준 없음 · 검사 기준에서 만들기
                          </Link>
                        )}
                      </Td>
                      <Td align="right">
                        <RowActions
                          canEdit={canEdit}
                          onEdit={() => setEditing(g)}
                          onDelete={() => deletion.open({ id: g.id, name: g.steelGradeCode, object: '강종을', remove: masterDataApi.deleteSteelGrade })}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rows.length === 0 ? <EmptyNote>등록된 강종이 없어요</EmptyNote> : null}
            </div>
            <TableFoot>
              성분 규격(C·Si·Mn·P·S, SM 계열 탄소당량)은 품질 담당이 검사 기준(제강)에서 버전으로 관리해요 · SM355는 A–D 등급을 각각 강종으로 등록해요 · 규격·원단위·검사
              기준·LOT가 쓰는 강종은 지울 수 없고 코드도 바꿀 수 없어요 (이름·적용 규격 번호는 고칠 수 있어요)
            </TableFoot>
          </>
        )}
      </QueryBoundary>
      {adding ? <SteelGradeModal onClose={() => setAdding(false)} /> : null}
      {editing ? <SteelGradeModal key={editing.id} editing={editing} onClose={() => setEditing(null)} /> : null}
      {deletion.dialog}
    </Card>
  );
}

/**
 * 강종 추가·수정 (API-169·280). 수정은 이름·적용 규격 번호를 언제든 고치고, 코드는 쓰는 곳이 없을 때만 바꾼다(서버가 확인).
 * 규격이 있는 강종은 화면에서도 코드를 잠가 둔다. 불러온 뒤 다른 사람이 고쳤으면 서버가 거절한다 (COM-001).
 */
function SteelGradeModal({ onClose, editing }: { onClose: () => void; editing?: MasterSteelGradeView }) {
  const fieldErrors = useMasterDataFieldErrors();
  const [code, setCode] = useState(editing?.steelGradeCode ?? '');
  const [name, setName] = useState(editing?.steelGradeName ?? '');
  const [standardNo, setStandardNo] = useState(editing?.standardNo ?? '');
  const create = useAction(masterDataApi.createSteelGrade, { onSuccess: onClose, onError: fieldErrors.takeFrom, success: '강종을 추가했어요' });
  const update = useAction(masterDataApi.updateSteelGrade, { onSuccess: onClose, onError: fieldErrors.takeFrom, success: '강종을 고쳤어요' });
  const pending = create.isPending || update.isPending;
  // 서버가 내려 준 쓰는 곳(품목·배합 원단위·검사 기준·LOT)이 하나라도 있으면 서버와 같은 기준으로 코드를 잠근다
  const lockedBy = editing?.codeLockedBy ?? [];
  const codeLocked = lockedBy.length > 0;
  const submit = () =>
    editing
      ? update.mutate({ id: editing.id, steelGradeCode: code, steelGradeName: name, standardNo, expectedUpdatedAt: editing.updatedAt })
      : create.mutate({ steelGradeCode: code, steelGradeName: name, standardNo });
  return (
    <Modal
      title={editing ? `강종 수정 · ${editing.steelGradeCode}` : '강종 추가'}
      onClose={onClose}
      width={460}
      footer={<ModalFooter pending={pending} submitLabel={editing ? '저장' : '추가'} onCancel={onClose} onSubmit={submit} />}
    >
      <Field label="강종 코드" required hint={codeLocked ? `쓰는 곳이 있어 코드를 바꿀 수 없어요: ${lockedBy.join('·')}` : '영문 대문자·숫자·하이픈 (예: SM355A)'} error={fieldErrors.errorOf('steelGradeCode')}>
        <Input
          value={code}
          disabled={codeLocked}
          maxLength={20}
          placeholder="SM355A"
          invalid={fieldErrors.errorOf('steelGradeCode') !== null}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            fieldErrors.clear('steelGradeCode');
          }}
        />
      </Field>
      <Field label="강종 이름" required error={fieldErrors.errorOf('steelGradeName')}>
        <Input
          value={name}
          maxLength={50}
          invalid={fieldErrors.errorOf('steelGradeName') !== null}
          onChange={(e) => {
            setName(e.target.value);
            fieldErrors.clear('steelGradeName');
          }}
        />
      </Field>
      <Field label="적용 규격 번호" hint="밀시트에 표시돼요 (예: KS D 3515:2018)" error={fieldErrors.errorOf('standardNo')}>
        <Input
          value={standardNo}
          maxLength={30}
          placeholder="KS D 3515:2018"
          invalid={fieldErrors.errorOf('standardNo') !== null}
          onChange={(e) => {
            setStandardNo(e.target.value);
            fieldErrors.clear('standardNo');
          }}
        />
      </Field>
    </Modal>
  );
}
