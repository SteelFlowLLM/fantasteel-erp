import { PERMISSION } from '@fantasteel/shared';
import { AppException } from '../../common/errors/app.exception';
import { diffPermissionMatrix, isEmptyDiff, normalizePermissionMatrix, summarizeDiff, type PermissionEntry } from './permission-matrix';

// @nestjs/common 12는 ESM 전용이라 플래그 없는 jest에서는 대체품을 쓴다 (testing/nest-common.shim.ts 참고)
jest.mock('@nestjs/common', () => require('./testing/nest-common.shim'));

const USE = 'USE' as const;
const VIEW = 'VIEW' as const;
const entry = (permissionCode: string, permissionLevel: 'USE' | 'VIEW'): PermissionEntry => ({ permissionCode, permissionLevel });
const adminBase = [entry(PERMISSION.EMPLOYEE_MANAGE, USE), entry(PERMISSION.ORG_MANAGE, USE)];

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppException);
    return (e as AppException).message;
  }
  throw new Error('예외가 나야 합니다');
}

describe('normalizePermissionMatrix (권한 행렬 검증)', () => {
  it('알려진 코드·수준이면 통과하고 화면 표시 순서로 정렬한다', () => {
    const out = normalizePermissionMatrix('SALES', [entry(PERMISSION.MILLSHEET_READ, VIEW), entry(PERMISSION.ORDER_CREATE, USE)]);
    expect(out.map((e) => e.permissionCode)).toEqual([PERMISSION.ORDER_CREATE, PERMISSION.MILLSHEET_READ]);
  });

  it('빈 목록은 권한 없음이다 (일반 역할)', () => {
    expect(normalizePermissionMatrix('QUALITY', [])).toEqual([]);
  });

  it('알 수 없는 권한 코드를 거부한다', () => {
    expect(messageOf(() => normalizePermissionMatrix('SALES', [entry('NOPE', USE)]))).toContain('NOPE');
  });

  it('USE·VIEW 이외의 수준을 거부한다', () => {
    expect(() => normalizePermissionMatrix('SALES', [{ permissionCode: PERMISSION.ORDER_CREATE, permissionLevel: 'ALL' as never }])).toThrow(AppException);
  });

  it('같은 권한 코드가 두 번 들어오면 거부한다', () => {
    expect(() => normalizePermissionMatrix('SALES', [entry(PERMISSION.ORDER_CREATE, USE), entry(PERMISSION.ORDER_CREATE, VIEW)])).toThrow(AppException);
  });

  describe('관리자 역할 잠금 방지', () => {
    it('EMPLOYEE_MANAGE·ORG_MANAGE를 USE로 유지하면 통과한다', () => {
      expect(() => normalizePermissionMatrix('ADMIN', [...adminBase, entry(PERMISSION.ORDER_CREATE, VIEW)])).not.toThrow();
    });

    it('ORG_MANAGE를 빼면 거부한다', () => {
      expect(() => normalizePermissionMatrix('ADMIN', [entry(PERMISSION.EMPLOYEE_MANAGE, USE)])).toThrow(AppException);
    });

    it('EMPLOYEE_MANAGE를 빼면 거부한다', () => {
      expect(() => normalizePermissionMatrix('ADMIN', [entry(PERMISSION.ORG_MANAGE, USE)])).toThrow(AppException);
    });

    it('USE를 VIEW로 낮추는 것도 거부한다', () => {
      expect(() => normalizePermissionMatrix('ADMIN', [entry(PERMISSION.EMPLOYEE_MANAGE, USE), entry(PERMISSION.ORG_MANAGE, VIEW)])).toThrow(AppException);
    });

    it('빈 목록으로 관리자 권한을 모두 지우는 것도 거부한다', () => {
      expect(() => normalizePermissionMatrix('ADMIN', [])).toThrow(AppException);
    });

    it('다른 역할에는 이 제한이 없다', () => {
      expect(() => normalizePermissionMatrix('SALES', [])).not.toThrow();
    });
  });
});

describe('diffPermissionMatrix', () => {
  const before = [entry(PERMISSION.ORDER_CREATE, USE), entry(PERMISSION.PO_CONFIRM, VIEW), entry(PERMISSION.MILLSHEET_READ, USE)];
  const after = [entry(PERMISSION.ORDER_CREATE, USE), entry(PERMISSION.PO_CONFIRM, USE), entry(PERMISSION.ORDER_CANCEL, VIEW)];

  it('추가·변경·제거를 나눈다', () => {
    const d = diffPermissionMatrix(before, after);
    expect(d.added).toEqual([entry(PERMISSION.ORDER_CANCEL, VIEW)]);
    expect(d.changed).toEqual([{ permissionCode: PERMISSION.PO_CONFIRM, from: VIEW, to: USE }]);
    expect(d.removed).toEqual([entry(PERMISSION.MILLSHEET_READ, USE)]);
  });

  it('같으면 빈 차이다', () => {
    expect(isEmptyDiff(diffPermissionMatrix(before, [...before].reverse()))).toBe(true);
  });

  it('작업 로그용 한 줄 요약을 만든다', () => {
    expect(summarizeDiff(diffPermissionMatrix(before, after))).toBe('추가 수주 취소(VIEW) · 변경 발주 VIEW→USE · 제거 밀시트 조회·출력(USE)');
  });
});
