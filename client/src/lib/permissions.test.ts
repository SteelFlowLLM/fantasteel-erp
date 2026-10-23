// 권한 확인 도우미: 변경 버튼은 사용(USE)만, 화면·메뉴는 조회(VIEW) 이상, 여러 권한 중 하나면 된다. 막혔을 때의 안내 문구.
import { describe, expect, it } from 'vitest';
import { canUse, canView, isDepartmentHead, permissionNeedText, type PermissionMap } from './permissions';

describe('권한 확인', () => {
  const user = { permissions: { SALES_ORDER_CREATE: 'VIEW', SHIPMENT_REQUEST_MANAGE: 'USE' } satisfies PermissionMap };

  it('조회만 있으면 보기는 되고 사용은 막힌다. 여러 권한 중 하나만 있어도 된다', () => {
    expect(canView(user, 'SALES_ORDER_CREATE')).toBe(true);
    expect(canUse(user, 'SALES_ORDER_CREATE')).toBe(false);
    expect(canUse(user, 'SALES_ORDER_CREATE', 'SHIPMENT_REQUEST_MANAGE')).toBe(true);
    expect(canView(user, 'PURCHASE_ORDER_CONFIRM', 'GOODS_RECEIPT_CONFIRM')).toBe(false);
  });

  it('부서장은 권한 코드가 아니라 부서장인 부서가 있는지로 본다 (REQ-AUTH-004)', () => {
    expect(isDepartmentHead({ headDepartmentIds: [3] })).toBe(true);
    expect(isDepartmentHead({ headDepartmentIds: [] })).toBe(false);
  });

  it('필요한 권한 안내: 권한 이름을 가운뎃점으로 잇고 수준을 붙인다 (기본은 사용)', () => {
    expect(permissionNeedText(['SALES_ORDER_CREATE', 'SALES_ORDER_CANCEL'], 'VIEW')).toBe('수주 등록·수주 취소 조회 권한이 필요해요');
    expect(permissionNeedText(['PURCHASE_ORDER_CONFIRM'])).toBe('발주 사용 권한이 필요해요');
  });
});
