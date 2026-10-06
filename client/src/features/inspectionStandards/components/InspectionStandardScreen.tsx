'use client';

// 검사 기준 (REQ-QC-002, 품질 메뉴, 검사 기준 관리 INSPECTION_STANDARD_MANAGE). 왼쪽 지금 버전 목록 | 오른쪽 버전 상세.
// 주소: ?process=공정&grade=강종 id(목록 거르기, 기준정보 강종·준비 상태 띠에서 넘어옴) · ?id=버전 id(고른 버전)
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { PERMISSION, PROCESS_TYPE_LABEL } from '@/codes';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { MasterPane, PageMain } from '@/components/Page';
import { QueryBoundary } from '@/components/QueryBoundary';
import { ReadOnlyHint } from '@/components/ReadOnlyHint';
import { EmptyNote, StateView } from '@/components/StateView';
import { Segmented } from '@/components/Tabs';
import { StandardDetail } from '@/features/inspectionStandards/components/StandardDetail';
import { StandardEditorModal, type StandardEditorTarget } from '@/features/inspectionStandards/components/StandardEditorModal';
import { INSPECTED_PROCESS_TYPES, type InspectedProcessType } from '@/features/inspectionStandards/lib/standardItems';
import { PROCESS_INSPECTION_TEXT, STANDARD_LOCK_TEXT } from '@/features/inspectionStandards/lib/standardText';
import { useInspectionStandardList } from '@/hooks/useInspectionStandards';
import { useMasterSteelGrades } from '@/hooks/useMasterData';
import { useCanUse } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';

type ProcessFilter = 'ALL' | InspectedProcessType;
const PROCESS_FILTERS: readonly { key: ProcessFilter; label: string }[] = [
  { key: 'ALL', label: '전체' },
  ...INSPECTED_PROCESS_TYPES.map((p) => ({ key: p, label: PROCESS_TYPE_LABEL[p] })),
];

export function InspectionStandardScreen() {
  const canEdit = useCanUse(PERMISSION.INSPECTION_STANDARD_MANAGE);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const grades = useMasterSteelGrades();
  const [editor, setEditor] = useState<StandardEditorTarget | null>(null);

  const processParam = params.get('process');
  const processType = INSPECTED_PROCESS_TYPES.find((p) => p === processParam);
  const gradeParam = Number(params.get('grade'));
  const steelGradeId = Number.isInteger(gradeParam) && gradeParam > 0 ? gradeParam : undefined;
  const idParam = Number(params.get('id'));
  const selectedParam = Number.isInteger(idParam) && idParam > 0 ? idParam : null;

  const list = useInspectionStandardList({ processType, steelGradeId });

  const navigate = useCallback(
    (next: { process?: InspectedProcessType; grade?: number; id?: number | null }) => {
      const search = new URLSearchParams();
      if (next.process) search.set('process', next.process);
      if (next.grade) search.set('grade', String(next.grade));
      if (next.id) search.set('id', String(next.id));
      const query = search.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const rows = list.data ?? [];
  const selectedId = selectedParam ?? rows[0]?.id ?? null;
  const gradeCode = grades.data?.find((g) => g.id === steelGradeId)?.steelGradeCode;

  return (
    <>
      <MasterPane
        head={
          <>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">검사 기준</h1>
              {list.data ? <span className="text-xs text-ink-3">{list.data.length}건</span> : null}
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                className="ml-auto"
                disabled={!canEdit}
                title={canEdit ? undefined : STANDARD_LOCK_TEXT}
                onClick={() => setEditor({ mode: 'create', processType: processType ?? null, steelGradeId: steelGradeId ?? null })}
              >
                기준 추가
              </Button>
            </div>
            <Segmented
              ariaLabel="공정"
              items={PROCESS_FILTERS}
              active={processType ?? 'ALL'}
              onChange={(key) => navigate({ process: key === 'ALL' ? undefined : key, grade: steelGradeId })}
            />
            <Select aria-label="강종" value={steelGradeId ? String(steelGradeId) : ''} onChange={(e) => navigate({ process: processType, grade: Number(e.target.value) || undefined })}>
              <option value="">강종 전체</option>
              {(grades.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.steelGradeCode}
                </option>
              ))}
            </Select>
            {canEdit ? null : <ReadOnlyHint permissions={[PERMISSION.INSPECTION_STANDARD_MANAGE]} />}
          </>
        }
      >
        <QueryBoundary query={list} loadingLabel="검사 기준을 불러오는 중…">
          {(standards) =>
            standards.length === 0 ? (
              <EmptyNote>{processType || steelGradeId ? '조건에 맞는 검사 기준이 없어요' : '등록된 검사 기준이 없어요'}</EmptyNote>
            ) : (
              <ul className="flex flex-col">
                {standards.map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        aria-current={active || undefined}
                        onClick={() => navigate({ process: processType, grade: steelGradeId, id: s.id })}
                        className={cn(
                          'flex w-full flex-col gap-1 border-b border-line px-4 py-2.5 text-left hover:bg-surface-2',
                          active && 'bg-brand-tint shadow-[inset_3px_0_0_var(--color-brand)] hover:bg-brand-tint',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-mono font-semibold">{s.inspectionStandardCode}</span>
                          <Badge tone="ok" plain className="ml-auto">
                            지금 v{s.version}
                          </Badge>
                        </span>
                        <span className="flex items-center gap-1.5 text-cap text-ink-3">
                          <span className="font-medium text-ink-2">{PROCESS_TYPE_LABEL[s.processType]}</span>·<span>{s.steelGradeCode ?? '공통 (모든 강종)'}</span>·
                          <span>항목 {s.itemCount}개</span>
                          {s.versionCount > 1 ? <span>· 버전 {s.versionCount}개</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </QueryBoundary>
      </MasterPane>
      <PageMain>
        {selectedId !== null ? (
          <StandardDetail
            id={selectedId}
            canEdit={canEdit}
            onSelectVersion={(id) => navigate({ process: processType, grade: steelGradeId, id })}
            onNewVersion={(detail) => setEditor({ mode: 'version', detail })}
            onDeleted={() => navigate({ process: processType, grade: steelGradeId })}
          />
        ) : list.data ? (
          <StateView
            kind="empty"
            icon="book"
            title={processType && gradeCode ? `${gradeCode} ${PROCESS_TYPE_LABEL[processType]} 검사 기준이 없어요` : '검사 기준을 골라 주세요'}
            text={
              processType && gradeCode
                ? `${PROCESS_INSPECTION_TEXT[processType]} 검사의 판정 기준이에요. 없으면 검사 결과가 판정 대기로 남아요.`
                : '공정·강종별 검사 항목과 min/max를 버전으로 관리해요. 바꾸면 새 버전이 생기고 이전 버전은 그대로 남아요.'
            }
            actions={
              <Button
                size="sm"
                variant="primary"
                icon="plus"
                disabled={!canEdit}
                title={canEdit ? undefined : STANDARD_LOCK_TEXT}
                onClick={() => setEditor({ mode: 'create', processType: processType ?? null, steelGradeId: steelGradeId ?? null })}
              >
                기준 추가
              </Button>
            }
          />
        ) : null}
      </PageMain>
      {editor ? (
        <StandardEditorModal
          target={editor}
          onClose={() => setEditor(null)}
          onSaved={(id) => {
            setEditor(null);
            navigate({ process: processType, grade: steelGradeId, id });
          }}
        />
      ) : null}
    </>
  );
}
