'use client';

// 강종 (REQ-MST-002): 강종 코드·이름·적용 규격 번호(TRM-113, 밀시트에 표시).
// 성분 규격(C·Si·Mn·P·S …)은 여기서 고치지 않는다. 제강 검사 기준의 항목이 곧 성분 규격이다(TRM-020) → 품질의 검사 기준으로 연결한다.
import Link from 'next/link';
import { useState } from 'react';
import { isMasterServerMode, masterDataApi, type MasterSteelGradeView } from '@/api/masterData';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import { CODE_LINK, MASTER_LOCK_TEXT, ModalFooter, RowActions, TableFoot } from '@/features/masterData/components/MasterParts';
import { useAction } from '@/hooks/useAction';
import { useMasterDataFieldErrors } from '@/hooks/useMasterDataForm';
import { useMasterSteelGrades } from '@/hooks/useMasterData';

const buildSteelmakingHref = (steelGradeId: number) => `/quality/standards?process=STEELMAKING&grade=${steelGradeId}`;

export function SteelGradeTab({ canEdit }: { canEdit: boolean }) {
  const grades = useMasterSteelGrades();
  const [editing, setEditing] = useState<MasterSteelGradeView | 'new' | null>(null);
  return (
    <Card>
      <CardHead
        title="강종"
        meta={grades.data ? `${grades.data.length}종` : undefined}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : MASTER_LOCK_TEXT} onClick={() => setEditing('new')}>
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
                    <tr key={g.id}>
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
                          onEdit={isMasterServerMode() ? undefined : () => setEditing(g)}
                          remove={{ what: `강종 ${g.steelGradeCode}`, run: () => masterDataApi.deleteSteelGrade(g.id), success: '강종을 삭제했어요', blockedReason: g.referenceText }}
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
              기준·LOT가 쓰는 강종은 지울 수 없어요
            </TableFoot>
          </>
        )}
      </QueryBoundary>
      {editing ? <SteelGradeModal grade={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function SteelGradeModal({ grade, onClose }: { grade: MasterSteelGradeView | null; onClose: () => void }) {
  const fieldErrors = useMasterDataFieldErrors();
  const [code, setCode] = useState(grade?.steelGradeCode ?? '');
  const [name, setName] = useState(grade?.steelGradeName ?? '');
  const [standardNo, setStandardNo] = useState(grade?.standardNo ?? '');
  const options = { onSuccess: onClose, onError: fieldErrors.takeFrom };
  const create = useAction(masterDataApi.createSteelGrade, { ...options, success: '강종을 추가했어요' });
  const update = useAction(masterDataApi.updateSteelGrade, { ...options, success: '강종을 저장했어요' });

  const submit = () => {
    if (grade) update.mutate({ id: grade.id, steelGradeName: name, standardNo, expectedUpdatedAt: grade.updatedAt });
    else create.mutate({ steelGradeCode: code, steelGradeName: name, standardNo });
  };
  return (
    <Modal
      title={grade ? `강종 수정 · ${grade.steelGradeCode}` : '강종 추가'}
      onClose={onClose}
      width={460}
      footer={<ModalFooter pending={create.isPending || update.isPending} submitLabel={grade ? '저장' : '추가'} onCancel={onClose} onSubmit={submit} />}
    >
      <Field label="강종 코드" required hint={grade ? '강종 코드는 바꿀 수 없어요' : '영문 대문자·숫자·하이픈 (예: SM355A)'} error={fieldErrors.errorOf('steelGradeCode')}>
        <Input
          value={code}
          readOnly={grade !== null}
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
