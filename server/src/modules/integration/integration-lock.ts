/**
 * 키(연결 대상)마다 작업을 한 줄로 세운다. 앞 작업이 실패해도 다음 작업은 돈다.
 * 토큰을 읽고 쓰는 작업(호출 중 갱신·콜백 토큰 교환·연결 시작·끊기)이 겹쳐 한쪽이 다른 쪽의 토큰을 덮어쓰지 않게 한다.
 * 서버 프로세스 안에서만 지킨다: 서버를 여러 대 띄우면 DB 잠금이 따로 필요하다.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
