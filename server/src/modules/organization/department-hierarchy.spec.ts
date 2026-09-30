import { wouldCreateCycle } from './department-hierarchy';

// HQ(1) ─ 생산부(2) ─ 제강(3) ─ 제강A(4),   HQ ─ 영업부(5)
const parentOf = new Map<number, number | null>([[1, null], [2, 1], [3, 2], [4, 3], [5, 1]]);

describe('wouldCreateCycle (부서 계층 순환 금지)', () => {
  it('자기 자신을 상위로 지정하면 순환이다', () => {
    expect(wouldCreateCycle(3, 3, parentOf)).toBe(true);
  });

  it('바로 아래 자식을 상위로 지정하면 순환이다', () => {
    expect(wouldCreateCycle(3, 4, parentOf)).toBe(true);
  });

  it('여러 단계 아래 후손을 상위로 지정해도 순환이다', () => {
    expect(wouldCreateCycle(1, 4, parentOf)).toBe(true);
    expect(wouldCreateCycle(2, 4, parentOf)).toBe(true);
  });

  it('계통이 다른 부서나 조상, 형제 밑으로 옮기는 것은 순환이 아니다', () => {
    expect(wouldCreateCycle(4, 5, parentOf)).toBe(false); // 다른 가지로 이동
    expect(wouldCreateCycle(4, 2, parentOf)).toBe(false); // 조상 아래로 올리기
    expect(wouldCreateCycle(3, 5, parentOf)).toBe(false);
    expect(wouldCreateCycle(5, 3, parentOf)).toBe(false);
  });

  it('상위 부서를 없애는 것(null)은 순환이 아니다', () => {
    expect(wouldCreateCycle(3, null, parentOf)).toBe(false);
  });

  it('이미 순환이 들어 있는 데이터에서도 끝난다', () => {
    const broken = new Map<number, number | null>([[1, 2], [2, 1], [3, null]]);
    expect(wouldCreateCycle(3, 1, broken)).toBe(true);
  });
});
