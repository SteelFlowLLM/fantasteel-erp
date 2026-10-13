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
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
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
  findSharedColumns,
  type SharedColumns,
} from '@/features/inspectionStandards/lib/standardItems';
import { PROCESS_INSPECTION_TEXT, STANDARD_LOCK_TEXT } from '@/features/inspectionStandards/lib/standardText';
import { PopItem, PopPanel } from '@/features/shell/PopPanel';
import { useAction } from '@/hooks/useAction';
import { useInspectionStandardDetail } from '@/hooks/useInspectionStandards';
import { usePopover } from '@/hooks/usePopover';
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
  // 모든 줄이 같은 칸은 표 위 한 줄로 접는다 (제강: 최소 없음·전체 두께·필수·KS가 모두 같아 최대만 다르다)
  const shared = findSharedColumns(view.items, changed.size > 0);
  const sharedText = [
    shared.required ? '필수' : null,
    shared.source ? (source === 'KS' ? 'KS 근거' : '사내 가정값') : null,
    shared.band ? '모든 두께' : null,
    shared.min ? '최소 없음' : null,
    shared.max ? '최대 없음' : null,
  ].filter((text): text is string => text !== null);
  const [deleting, setDeleting] = useState(false);
  const more = usePopover<HTMLDivElement>();
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
            {view.isCurrent ? (
              <span className="inline-flex" data-pet-term="지금 버전">
                <Badge tone="ok">지금 버전</Badge>
              </span>
            ) : (
              <span className="inline-flex" data-pet-term="이전 버전 · 읽기 전용">
                <Badge tone="neutral">이전 버전 · 읽기 전용</Badge>
              </span>
            )}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {view.isCurrent ? (
            <Button variant="primary" icon="plus" disabled={!canEdit} title={canEdit ? undefined : STANDARD_LOCK_TEXT} onClick={() => onNewVersion(view)}>
              새 버전 만들기
            </Button>
          ) : (
            <Button icon="arrow-right" onClick={() => onSelectVersion(view.currentId)}>
              지금 버전(v{current?.version ?? '-'}) 보기
            </Button>
          )}
          {/* 모든 버전이 지워지는 동작이라 자주 쓰는 "새 버전 만들기" 옆에 두지 않고 더보기 메뉴 안에 둔다 (확인 창은 그대로) */}
          <div ref={more.ref} className="relative">
            <IconButton icon="more" label="기준 더보기" aria-haspopup="menu" aria-expanded={more.open} onClick={() => more.setOpen(!more.open)} />
            {more.open ? (
              <PopPanel label="기준 더보기" role="menu" placement="right-narrow">
                <PopItem
                  role="menuitem"
                  centered
                  className="text-danger"
                  disabled={!canEdit}
                  title={canEdit ? '이 기준의 모든 버전을 지워요' : STANDARD_LOCK_TEXT}
                  onClick={() => {
                    more.setOpen(false);
                    setDeleting(true);
                  }}
                >
                  <Icon name="trash" size="sm" />
                  기준 삭제
                </PopItem>
              </PopPanel>
            ) : null}
          </div>
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

      {/* 좁은 화면(1366·1280 발표 화면 등)에서는 오른쪽 280px 칸 때문에 표 오른쪽(최대·적용 두께 구간)이 잘렸다: 1400px 미만이면 기준 정보·버전을 표 아래로 내린다 */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1400px]:grid-cols-[minmax(0,1fr)_280px]">
        <Card petKey="card:inspectionStandards.items">
          <CardHead
            title="검사 항목"
            meta={`${view.items.length}개${changed.size > 0 || removed > 0 ? ` · 이전 버전에서 바뀜 ${changed.size}개${removed > 0 ? ` · 빠짐 ${removed}개` : ''}` : ''}`}
          />
          {sharedText.length > 0 ? (
            <p className="border-b border-line px-4 py-2 text-cap text-ink-2" title={source === 'KS' && view.standardNo ? `KS 값 (${view.standardNo}, 치수는 KS D 3500)` : undefined}>
              <b className="font-semibold">모든 항목 같음</b> · {sharedText.join(' · ')}
            </p>
          ) : null}
          {/* 열 수가 적은 기준은 표가 넓게 늘어나 왼쪽·오른쪽 정렬이면 이름과 값이 멀어진다: 칸 가운데에 모아 읽히게 */}
          <div className="overflow-auto">
            <Table>
              <thead>
                <tr>
                  <Th align="center" className="w-12">순서</Th>
                  <Th align="center">항목 코드</Th>
                  <Th align="center">항목명</Th>
                  <Th align="center">단위</Th>
                  {shared.min ? null : <Th align="center">최소 (이상)</Th>}
                  {shared.max ? null : <Th align="center">최대 (이하)</Th>}
                  {shared.band ? null : <Th align="center">적용 두께 구간 (mm)</Th>}
                  {shared.required ? null : <Th align="center">필수</Th>}
                  {shared.source ? null : <Th align="center">근거</Th>}
                </tr>
              </thead>
              <tbody>
                {view.items.map((item, index) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    continued={view.items[index - 1]?.inspectionItemCode === item.inspectionItemCode}
                    continues={view.items[index + 1]?.inspectionItemCode === item.inspectionItemCode}
                    changed={changed.has(buildStandardItemKey(item))}
                    shared={shared}
                    source={source}
                    standardNo={view.standardNo}
                  />
                ))}
              </tbody>
            </Table>
            {view.items.length === 0 ? <EmptyNote>검사 항목이 없어요</EmptyNote> : null}
          </div>
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-cap leading-normal text-ink-3" data-pet-term="판정 규칙">
            최소·최대는 경계값을 포함해 판정해요(이상·이하) · 적용 두께 구간은 &lsquo;초과 ~ 이하&rsquo;로 고르고, 비어 있으면 모든 두께에 적용해요 · 필수 항목 값이 없거나 기준이
            없으면 판정 대기로 남아요 · 바꾸면 새 버전이 생기고 이전 버전은 그대로 남아요
          </p>
        </Card>

        <div className="grid grid-cols-2 items-start gap-4 min-[1400px]:flex min-[1400px]:flex-col min-[1400px]:items-stretch">
          <Card petKey="card:inspectionStandards.info">
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
            {process ? (
              <p className="border-t border-line px-4 py-2.5 text-cap leading-normal text-ink-2" data-pet-term={`${PROCESS_TYPE_LABEL[process]} 기준 안내`}>
                {PROCESS_NOTE[process]}
              </p>
            ) : null}
          </Card>
          <Card petKey="card:inspectionStandards.versions">
            <CardHead title="버전" meta={`${view.versions.length}개`} />
            <ul className="flex flex-col">
              {view.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-current={v.id === view.id || undefined}
                    data-pet-item="inspectionStandard"
                    data-pet-item-title={`${view.inspectionStandardCode} v${v.version}`}
                    onClick={() => onSelectVersion(v.id)}
                    className={cn('flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left text-sm last:border-b-0 hover:bg-surface-2', v.id === view.id && 'bg-brand-tint hover:bg-brand-tint-hover')}
                  >
                    <span className="font-mono font-semibold" data-pet-field="버전">
                      v{v.version}
                    </span>
                    <span className="text-cap text-ink-3">
                      <span data-pet-field="버전 생성">{fmtMD(v.createdAt)}</span> · <span data-pet-field="항목 수">항목 {v.itemCount}개</span> ·{' '}
                      <span data-pet-field="판정한 검사">검사 {v.inspectionCount}건</span>
                    </span>
                    {v.isCurrent ? (
                      <span className="ml-auto inline-flex" data-pet-term="지금">
                        <Badge tone="ok" plain>
                          지금
                        </Badge>
                      </span>
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

interface ItemRowProps {
  item: InspectionStandardItemView;
  index: number;
  /** 바로 위 줄과 같은 항목 (두께 구간만 다름) */
  continued: boolean;
  /** 바로 아래 줄도 같은 항목 */
  continues: boolean;
  changed: boolean;
  /** 모든 줄이 같아 표 위 요약으로 옮긴 칸 (그리지 않는다) */
  shared: SharedColumns;
  source: 'KS' | 'ASSUMED';
  standardNo: string | null;
}

/**
 * 두께 구간마다 같은 항목이 이어지면(열연 항복강도 5줄 등) 한 묶음으로 보인다:
 * 코드·이름·단위는 묶음 첫 줄에만 쓰고, 묶음 안의 줄 사이 선은 지운다. 값과 두께 구간이 먼저 읽힌다.
 */
function ItemRow({ item, index, continued, continues, changed, shared, source, standardNo }: ItemRowProps) {
  return (
    <tr className={cn(continues && '[&>td]:border-b-transparent')} data-pet-item="inspectionStandardItem" data-pet-item-title={`${item.inspectionItemCode} ${item.inspectionItemName}`}>
      <Td align="center" className="tabular-nums text-ink-3">{index + 1}</Td>
      <Td align="center" className="font-mono text-mono">{continued ? null : item.inspectionItemCode}</Td>
      <Td align="center">{continued ? null : item.inspectionItemName}</Td>
      <Td align="center" className="text-ink-2">{continued ? null : (item.unit ?? '—')}</Td>
      {shared.min ? null : <Td align="center">{formatValue(item.minValue)}</Td>}
      {shared.max ? null : <Td align="center">{formatValue(item.maxValue)}</Td>}
      {shared.band ? null : <Td align="center">{formatThicknessBand(item)}</Td>}
      {/* 거의 모든 줄이 필수·KS라 배지로 칠하면 값보다 먼저 보인다: 흔한 값은 글자로, 다른 값(선택·가정값·바뀜)만 배지로 */}
      {shared.required ? null : (
        <Td align="center">
          <span className="inline-flex" data-pet-term={item.isRequired ? '필수' : '선택'}>
            {item.isRequired ? <span className="text-ink-2">필수</span> : <Badge>선택</Badge>}
          </span>
        </Td>
      )}
      {shared.source ? null : (
      <Td align="center">
        <span className="inline-flex items-center gap-1">
          {source === 'KS' ? (
            <span className="text-cap text-ink-3" title={standardNo ? `KS 값 (${standardNo}, 치수는 KS D 3500)` : 'KS 값'} data-pet-term="KS">
              KS
            </span>
          ) : (
            <span className="inline-flex" data-pet-term="가정값">
              <Tag size="sm" tone="outline" title="KS에 없어 정한 사내 가정값이에요">
                가정값
              </Tag>
            </span>
          )}
          {changed ? (
            <span className="inline-flex" data-pet-term="바뀜">
              <Tag size="sm" tone="run" title="이전 버전에서 새로 생기거나 값이 바뀐 항목이에요">
                바뀜
              </Tag>
            </span>
          ) : null}
        </span>
      </Td>
      )}
    </tr>
  );
}
