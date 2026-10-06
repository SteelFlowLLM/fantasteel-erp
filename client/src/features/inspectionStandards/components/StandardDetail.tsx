'use client';

// 검사 기준 한 버전의 상세: 머리(코드·공정·강종·적용 규격·버전), 버전 목록, 검사 항목 표.
// 이전 버전은 읽기 전용으로 보인다. 값의 근거(KS / 가정값)와 이전 버전에서 바뀐 항목을 표시한다.
import { useState } from 'react';
import { PROCESS_TYPE_LABEL } from '@/codes';
import { inspectionStandardApi, type InspectionStandardDetailView, type InspectionStandardItemView } from '@/api/inspectionStandards';
import { Badge } from '@/components/Badge';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card, CardHead } from '@/components/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KvList } from '@/components/KvList';
import { QueryBoundary } from '@/components/QueryBoundary';
import { EmptyNote, StateView } from '@/components/StateView';
import { Table, Td, Th } from '@/components/Table';
import { Tag } from '@/components/Tag';
import {
  findChangedItemKeys,
  isInspectedProcess,
  countRemovedItems,
  buildStandardItemKey,
  getStandardValueSource,
  formatThicknessBand,
} from '@/features/inspectionStandards/lib/standardItems';
import { PROCESS_INSPECTION_TEXT, STANDARD_LOCK_TEXT } from '@/features/inspectionStandards/lib/standardText';
import { useAction } from '@/hooks/useAction';
import { useInspectionStandardDetail } from '@/hooks/useInspectionStandards';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtMD } from '@/lib/format';

const trimZeros = (value: string) => (value.includes('.') ? value.replace(/\.?0+$/, '') : value);
const formatValue = (value: string | null) => (value === null ? '—' : trimZeros(value));

/** 공정별 안내 (REQ-QC-001·002, ks-values.md) */
const PROCESS_NOTE = {
  STEELMAKING: '제강 기준의 항목이 이 강종의 성분 규격이에요(히트 성분 판정). 값은 KS 상한이고, SM 계열 C·탄소당량은 50mm 이하 값을 써요.',
  CONTINUOUS_CASTING: '슬래브 전용 KS 규격이 없어 표면·치수 기준은 사내 가정값이에요. 사내 규격이 정해지면 새 버전으로 바꿔 주세요.',
  HOT_ROLLING: '기계적 성질은 KS 두께 구간별 값이고 적용 두께 구간은 초과~이하로 판정해요. 샤르피 충격은 SM 계열 두께 6mm 초과에만 적용해요.',
} as const;

export interface StandardDetailProps {
  id: number;
  canEdit: boolean;
  onSelectVersion: (id: number) => void;
  onNewVersion: (detail: InspectionStandardDetailView) => void;
  /** 기준(모든 버전)을 지운 뒤 */
  onDeleted: () => void;
}

export function StandardDetail({ id, canEdit, onSelectVersion, onNewVersion, onDeleted }: StandardDetailProps) {
  const detail = useInspectionStandardDetail(id);
  return (
    <QueryBoundary query={detail} loadingLabel="검사 기준을 불러오는 중…">
      {(view) =>
        view === null ? (
          <StateView kind="empty" icon="book" title="검사 기준을 찾지 못했어요" text="지워졌거나 잘못된 주소예요. 왼쪽 목록에서 다시 골라 주세요." code="COM-003" />
        ) : (
          <DetailBody view={view} canEdit={canEdit} onSelectVersion={onSelectVersion} onNewVersion={onNewVersion} onDeleted={onDeleted} />
        )
      }
    </QueryBoundary>
  );
}

function DetailBody({ view, canEdit, onSelectVersion, onNewVersion, onDeleted }: { view: InspectionStandardDetailView } & Omit<StandardDetailProps, 'id'>) {
  const process = isInspectedProcess(view.processType) ? view.processType : null;
  const source = getStandardValueSource(view.processType);
  const changed = view.previousItems ? findChangedItemKeys(view.items, view.previousItems) : new Set<string>();
  const removed = view.previousItems ? countRemovedItems(view.items, view.previousItems) : 0;
  const current = view.versions.find((v) => v.isCurrent);
  const [deleting, setDeleting] = useState(false);
  const remove = useAction(inspectionStandardApi.remove, {
    success: (result) => `${result.inspectionStandardCode} 검사 기준을 삭제했어요 (버전 ${result.deletedVersions.length}개)`,
    onSuccess: () => {
      setDeleting(false);
      onDeleted();
    },
    onError: () => setDeleting(false),
  });

  return (
    <>
      <div className="flex flex-none items-end gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-cap font-medium text-ink-3">
            {PROCESS_TYPE_LABEL[view.processType]} · {process ? PROCESS_INSPECTION_TEXT[process] : ''} 검사
          </span>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <span className="font-mono">{view.inspectionStandardCode}</span>
            <Tag tone="outline">v{view.version}</Tag>
            {view.isCurrent ? <Badge tone="ok">지금 버전</Badge> : <Badge tone="neutral">이전 버전 · 읽기 전용</Badge>}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button icon="trash" disabled={!canEdit} title={canEdit ? '이 기준의 모든 버전을 지워요' : STANDARD_LOCK_TEXT} onClick={() => setDeleting(true)}>
            기준 삭제
          </Button>
          {view.isCurrent ? (
            <Button variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : STANDARD_LOCK_TEXT} onClick={() => onNewVersion(view)}>
              새 버전 만들기
            </Button>
          ) : (
            <Button icon="arrow-right" onClick={() => onSelectVersion(view.currentId)}>
              지금 버전(v{current?.version ?? '-'}) 보기
            </Button>
          )}
        </div>
      </div>

      {view.isCurrent ? null : (
        <Banner tone="wait">
          이전 버전(v{view.version})이에요. 고칠 수 없고, 이 버전으로 판정한 검사 기록 {view.inspectionCount}건은 그대로 이 버전을
          참조해요. 바꾸려면 지금 버전에서 새 버전을 만들어 주세요.
        </Banner>
      )}

      {deleting ? (
        <ConfirmDialog
          title="검사 기준을 삭제할까요?"
          confirmLabel="삭제"
          tone="danger"
          pending={remove.isPending}
          onCancel={() => setDeleting(false)}
          onConfirm={() => remove.mutate(view.id)}
        >
          {view.inspectionStandardCode}의 모든 버전({view.versionCount}개)과 검사 항목을 지워요. 되돌릴 수 없어요. 어느 버전이든 검사 판정에 쓰였으면 삭제할 수 없고, 그때는 새
          버전으로 고쳐 주세요.
        </ConfirmDialog>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_280px] items-start gap-4">
        <Card>
          <CardHead
            title="검사 항목"
            meta={`${view.items.length}개${changed.size > 0 || removed > 0 ? ` · 이전 버전에서 바뀜 ${changed.size}개${removed > 0 ? ` · 빠짐 ${removed}개` : ''}` : ''}`}
          />
          <div className="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">순서</Th>
                  <Th>항목 코드</Th>
                  <Th>항목명</Th>
                  <Th>단위</Th>
                  <Th align="right">최소 (이상)</Th>
                  <Th align="right">최대 (이하)</Th>
                  <Th>적용 두께 구간 (mm)</Th>
                  <Th>필수</Th>
                  <Th>근거</Th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((item, index) => (
                  <ItemRow key={item.id} item={item} index={index} changed={changed.has(buildStandardItemKey(item))} source={source} standardNo={view.standardNo} />
                ))}
              </tbody>
            </Table>
            {view.items.length === 0 ? <EmptyNote>검사 항목이 없어요</EmptyNote> : null}
          </div>
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-cap leading-normal text-ink-3">
            최소·최대는 경계값을 포함해 판정해요(이상·이하) · 적용 두께 구간은 &lsquo;초과 ~ 이하&rsquo;로 고르고, 비어 있으면 모든 두께에 적용해요 · 필수 항목 값이 없거나 기준이
            없으면 판정 대기로 남아요 · 바꾸면 새 버전이 생기고 이전 버전은 그대로 남아요
          </p>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHead title="기준 정보" />
            <div className="p-4">
              <KvList
                items={[
                  { label: '공정', value: PROCESS_TYPE_LABEL[view.processType] },
                  { label: '강종', value: view.steelGradeCode ?? '공통 (모든 강종)' },
                  { label: '적용 규격', value: view.standardNo ?? '—' },
                  { label: '버전 생성', value: fmtDateTime(view.createdAt) },
                  { label: '판정한 검사', value: `${view.inspectionCount}건` },
                ]}
              />
            </div>
            {process ? <p className="border-t border-line px-4 py-2.5 text-cap leading-normal text-ink-2">{PROCESS_NOTE[process]}</p> : null}
          </Card>
          <Card>
            <CardHead title="버전" meta={`${view.versions.length}개`} />
            <ul className="flex flex-col">
              {view.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-current={v.id === view.id || undefined}
                    onClick={() => onSelectVersion(v.id)}
                    className={cn('flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2', v.id === view.id && 'bg-brand-tint hover:bg-brand-tint-hover')}
                  >
                    <span className="font-mono font-semibold">v{v.version}</span>
                    <span className="text-cap text-ink-3">
                      {fmtMD(v.createdAt)} · 항목 {v.itemCount}개 · 검사 {v.inspectionCount}건
                    </span>
                    {v.isCurrent ? (
                      <Badge tone="ok" plain className="ml-auto">
                        지금
                      </Badge>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function ItemRow({ item, index, changed, source, standardNo }: { item: InspectionStandardItemView; index: number; changed: boolean; source: 'KS' | 'ASSUMED'; standardNo: string | null }) {
  return (
    <tr>
      <Td className="tabular-nums text-ink-3">{index + 1}</Td>
      <Td className="font-mono text-mono">{item.inspectionItemCode}</Td>
      <Td>{item.inspectionItemName}</Td>
      <Td className="text-ink-2">{item.unit ?? '—'}</Td>
      <Td align="right">{formatValue(item.minValue)}</Td>
      <Td align="right">{formatValue(item.maxValue)}</Td>
      <Td>{formatThicknessBand(item)}</Td>
      <Td>{item.isRequired ? <Badge tone="ok">필수</Badge> : <Badge>선택</Badge>}</Td>
      <Td>
        <span className="inline-flex items-center gap-1">
          {source === 'KS' ? (
            <Tag size="sm" tone="brand" title={standardNo ? `KS 값 (${standardNo}, 치수는 KS D 3500)` : 'KS 값'}>
              KS
            </Tag>
          ) : (
            <Tag size="sm" tone="outline" title="KS에 없어 정한 사내 가정값이에요">
              가정값
            </Tag>
          )}
          {changed ? (
            <Tag size="sm" tone="run" title="이전 버전에서 새로 생기거나 값이 바뀐 항목이에요">
              바뀜
            </Tag>
          ) : null}
        </span>
      </Td>
    </tr>
  );
}
