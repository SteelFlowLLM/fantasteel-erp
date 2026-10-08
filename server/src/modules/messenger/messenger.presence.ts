/**
 * 접속 상태: 사원별로 열린 소켓 수를 센다. 탭·기기를 여러 개 열 수 있어 첫 연결에서 접속, 마지막 연결이 끊길 때 나감으로 본다.
 * 서버 메모리에만 둔다(ERD 변경 없음). 서버를 여러 대로 늘리면 Redis 등 공유 저장소로 옮겨야 한다.
 */
export class MessengerPresence {
  private readonly sockets = new Map<number, number>();

  /** 연결이 하나 늘었다. 이 사원의 첫 연결이면 true */
  connect(employeeId: number): boolean {
    const count = (this.sockets.get(employeeId) ?? 0) + 1;
    this.sockets.set(employeeId, count);
    return count === 1;
  }

  /** 연결이 하나 끊겼다. 이 사원의 마지막 연결이었으면 true */
  disconnect(employeeId: number): boolean {
    const count = (this.sockets.get(employeeId) ?? 0) - 1;
    if (count > 0) {
      this.sockets.set(employeeId, count);
      return false;
    }
    const wasOnline = this.sockets.delete(employeeId);
    return wasOnline;
  }

  onlineEmployeeIds(): number[] {
    return [...this.sockets.keys()].sort((a, b) => a - b);
  }
}
