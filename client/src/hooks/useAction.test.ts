// 변경 성공 뒤 순서: 안내는 바로, onSuccess는 다시 불러오기가 끝난 뒤.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterActionSuccess } from '@/hooks/useAction';
import { useToastStore } from '@/stores/useToastStore';

afterEach(() => {
  useToastStore.setState({ items: [] });
});

const texts = () => useToastStore.getState().items.map((item) => item.text);

describe('변경 성공 뒤 순서 (afterActionSuccess)', () => {
  it('성공 안내는 다시 불러오기가 끝나기 전에 뜨고, onSuccess는 끝난 뒤에 불린다', async () => {
    let finishRefresh: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finishRefresh = resolve)));
    const onSuccess = vi.fn();
    const done = afterActionSuccess(refresh, { success: '발주를 확정했어요', onSuccess }, { id: 7 }, 'input');

    // 다시 불러오는 중: 안내는 이미 떴고 onSuccess는 아직이다
    expect(texts()).toEqual(['발주를 확정했어요']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();

    finishRefresh();
    await done;
    expect(onSuccess).toHaveBeenCalledWith({ id: 7 }, 'input');
  });

  it('success가 함수면 응답으로 문구를 만들고, 없으면 안내 없이 다시 불러온 뒤 onSuccess만 부른다', async () => {
    const refresh = vi.fn(async () => undefined);
    await afterActionSuccess(refresh, { success: (data: { no: string }) => `${data.no}을 등록했어요` }, { no: 'SO-1' }, null);
    expect(texts()).toEqual(['SO-1을 등록했어요']);

    useToastStore.setState({ items: [] });
    const onSuccess = vi.fn();
    await afterActionSuccess(refresh, { onSuccess }, 'ok', 3);
    expect(texts()).toEqual([]);
    expect(onSuccess).toHaveBeenCalledWith('ok', 3);
  });
});
