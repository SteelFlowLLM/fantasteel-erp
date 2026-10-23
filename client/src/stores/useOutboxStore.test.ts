// 보내는 중·실패 메시지 보관함: 성공하면 지우고, 실패하면 이유와 함께 남기며, 다시 보내기는 실패한 것만, 보내는 중에는 두 번 보내지 않는다.
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/api/errors';
import type { SendMessageInput } from '@/api/messenger';
import { deliverOutboxItem, retryOutboxItem, useOutboxStore } from '@/stores/useOutboxStore';

const input = (content: string): SendMessageInput => ({ chatRoomId: 7, content });
const items = () => useOutboxStore.getState().items;

afterEach(() => useOutboxStore.setState({ items: [] }));

describe('메시지 보관함 (useOutboxStore)', () => {
  it('보내는 동안은 보내는 중으로 보이고, 성공하면 보관함에서 지운다', async () => {
    const id = useOutboxStore.getState().add(input('안녕하세요'));
    let resolve: () => void = () => undefined;
    const delivering = deliverOutboxItem(id, () => new Promise<void>((r) => (resolve = r)));
    expect(items()).toEqual([expect.objectContaining({ localId: id, status: 'sending', errorText: null })]);
    resolve();
    expect(await delivering).toBe(true);
    expect(items()).toEqual([]);
  });

  it('실패하면 이유와 함께 남고, 다시 보내서 성공하면 지운다', async () => {
    const id = useOutboxStore.getState().add(input('확인 부탁해요'));
    expect(await deliverOutboxItem(id, () => Promise.reject(new Error('서버에 연결할 수 없어요')))).toBe(false);
    expect(items()[0]).toMatchObject({ status: 'failed', errorText: '서버에 연결할 수 없어요' });

    const firstId = items()[0].input.clientMessageId;
    expect(firstId).toMatch(/^[A-Za-z0-9-]+$/);
    const sent: SendMessageInput[] = [];
    expect(await retryOutboxItem(id, async (value) => void sent.push(value))).toBe(true);
    // 다시 보내도 같은 보내기 id라 서버가 두 번 저장하지 않는다
    expect(sent).toEqual([{ ...input('확인 부탁해요'), clientMessageId: firstId }]);
    expect(items()).toEqual([]);
  });

  it('업무 오류는 코드와 함께 이유로 남는다', async () => {
    const id = useOutboxStore.getState().add(input('끼어들기'));
    await deliverOutboxItem(id, () => Promise.reject(new ApiError('COM-002', '채팅방 멤버만 볼 수 있어요')));
    expect(items()[0].errorText).toContain('COM-002');
  });

  it('보내는 중인 메시지는 다시 보내기를 눌러도 한 번만 보낸다', async () => {
    const id = useOutboxStore.getState().add(input('한 번만'));
    let calls = 0;
    const first = deliverOutboxItem(id, async () => {
      calls += 1;
    });
    expect(await retryOutboxItem(id, async () => {
      calls += 1;
    })).toBe(false);
    await first;
    expect(calls).toBe(1);
  });

  it('지우면 사라지고, 다른 방 메시지는 그대로 둔다', () => {
    const keep = useOutboxStore.getState().add({ chatRoomId: 8, content: '다른 방' });
    const drop = useOutboxStore.getState().add(input('지울 것'));
    useOutboxStore.getState().remove(drop);
    expect(items().map((i) => i.localId)).toEqual([keep]);
  });
});
