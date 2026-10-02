'use client';

// 이력 재현 대상 고르기: 수주번호·LOT 번호 일부를 입력하고 목록에서 고른다. 고르면 칩으로 바뀌고 X로 지운다.
import { useState, type ReactNode } from 'react';
import { LOT_TYPE_LABEL } from '@/codes';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/Input';
import { PopItem, PopList, PopNote, PopPanel } from '@/features/shell/PopPanel';
import { useDebouncedValue } from '@/hooks/useGlobalSearch';
import { useSalesOrderOptions } from '@/hooks/useBusinessEvents';
import { useLotSearch } from '@/hooks/useLotTrace';
import { usePopover } from '@/hooks/usePopover';
import { cn } from '@/lib/cn';

interface PickerOption {
  key: number;
  label: string;
  sub: string;
}

interface PickerShellProps {
  icon: IconName;
  ariaLabel: string;
  placeholder: string;
  widthClass: string;
  selectedLabel: string | null;
  keyword: string;
  onKeyword: (keyword: string) => void;
  options: readonly PickerOption[] | undefined;
  loading: boolean;
  onPick: (option: PickerOption) => void;
  onClear: () => void;
}

function PickerShell({ icon, ariaLabel, placeholder, widthClass, selectedLabel, keyword, onKeyword, options, loading, onPick, onClear }: PickerShellProps) {
  const popover = usePopover<HTMLDivElement>();
  if (selectedLabel !== null) {
    return (
      <span className={cn('inline-flex h-8 items-center gap-1.5 rounded-sm border border-brand bg-brand-tint pr-1 pl-2.5 text-sm text-brand', widthClass)}>
        <Icon name={icon} size="sm" />
        <span className="min-w-0 flex-1 truncate font-mono text-mono font-semibold">{selectedLabel}</span>
        <IconButton icon="x" label={`${ariaLabel} 지우기`} size="sm" className="size-6" onClick={onClear} />
      </span>
    );
  }
  let body: ReactNode = null;
  if (loading && !options?.length) body = <PopNote>찾는 중…</PopNote>;
  else if (options && !options.length) body = <PopNote>맞는 번호가 없어요</PopNote>;
  else if (options)
    body = options.map((option) => (
      <PopItem
        key={option.key}
        role="option"
        aria-selected="false"
        centered
        onClick={() => {
          popover.setOpen(false);
          onPick(option);
        }}
      >
        <span className="min-w-0 truncate font-mono text-mono">{option.label}</span>
        <span className="ml-auto flex-none text-cap text-ink-3">{option.sub}</span>
      </PopItem>
    ));
  return (
    <div ref={popover.ref} className={cn('relative', widthClass)}>
      <Input
        type="search"
        leadingIcon={icon}
        value={keyword}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={() => popover.setOpen(true)}
        onChange={(event) => {
          onKeyword(event.target.value);
          popover.setOpen(true);
        }}
      />
      {popover.open ? (
        <PopPanel label={`${ariaLabel} 고르기`} role="listbox" placement="stretch">
          <PopList>{body}</PopList>
        </PopPanel>
      ) : null}
    </div>
  );
}

export function SalesOrderPicker({ salesOrderId, salesOrderNo, onPick, onClear }: { salesOrderId: number | undefined; salesOrderNo: string | null; onPick: (id: number) => void; onClear: () => void }) {
  const [keyword, setKeyword] = useState('');
  const term = useDebouncedValue(keyword);
  const options = useSalesOrderOptions(term, salesOrderId === undefined);
  return (
    <PickerShell
      icon="clipboard"
      ariaLabel="수주번호"
      placeholder="수주번호"
      widthClass="w-[200px]"
      selectedLabel={salesOrderId !== undefined ? (salesOrderNo ?? `수주 ${salesOrderId}`) : null}
      keyword={keyword}
      onKeyword={setKeyword}
      options={options.data?.map((so) => ({ key: so.id, label: so.salesOrderNo, sub: so.customerName }))}
      loading={options.isFetching}
      onPick={(option) => {
        setKeyword('');
        onPick(option.key);
      }}
      onClear={onClear}
    />
  );
}

export function LotPicker({ lotId, lotNo, onPick, onClear }: { lotId: number | undefined; lotNo: string | null; onPick: (id: number) => void; onClear: () => void }) {
  const [keyword, setKeyword] = useState('');
  const term = useDebouncedValue(keyword.trim());
  const options = useLotSearch({ keyword: term, limit: 10 });
  return (
    <PickerShell
      icon="trace"
      ariaLabel="LOT 번호"
      placeholder="LOT 번호"
      widthClass="w-[230px]"
      selectedLabel={lotId !== undefined ? (lotNo ?? `LOT ${lotId}`) : null}
      keyword={keyword}
      onKeyword={setKeyword}
      options={options.data?.items.map((lot) => ({ key: lot.id, label: lot.lotNo, sub: LOT_TYPE_LABEL[lot.lotType] }))}
      loading={options.isFetching}
      onPick={(option) => {
        setKeyword('');
        onPick(option.key);
      }}
      onClear={onClear}
    />
  );
}

