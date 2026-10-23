import { ERROR_CODES, PERMISSION, resolveDataScope } from '@gc/shared';
import type { AuthenticatedUser } from '../types';
import { assertInScope, buildScopeWhere, canAccessResource } from './scope.util';
import { describe, expect, it } from 'vitest';

const baseUser = {
  userId: 'u-1',
  username: 'dr.wang',
  displayName: '王医生',
  departmentId: 'd-endo',
  departmentName: '内分泌科',
  permissions: [PERMISSION.PATIENT_VIEW],
  roles: ['DOCTOR'],
} as unknown as AuthenticatedUser;

const user = (dataScope: string) => ({ ...baseUser, dataScope }) as AuthenticatedUser;

describe('resolveDataScope', () => {
  it('多角色取最宽松档', () => {
    expect(resolveDataScope(['DOCTOR', 'SYS_ADMIN'])).toBe('ALL');
  });

  it('无有效角色时按最小权限返回 NONE', () => {
    expect(resolveDataScope([])).toBe('NONE');
    expect(resolveDataScope(['UNKNOWN_ROLE'])).toBe('NONE');
  });

  it('非法角色码不扩大权限', () => {
    expect(resolveDataScope(['NURSE', 'HACKER'])).toBe('DEPARTMENT');
  });
});

describe('buildScopeWhere', () => {
  it('ALL 档不加限制', () => {
    expect(buildScopeWhere(user('ALL'), 'PATIENT')).toEqual({});
  });

  it('DEPARTMENT 档：患者按科室过滤', () => {
    expect(buildScopeWhere(user('DEPARTMENT'), 'PATIENT')).toEqual({ departmentId: 'd-endo' });
  });

  it('SELF 档：审计类资源经 operatorId 过滤', () => {
    expect(buildScopeWhere(user('SELF'), 'AUDIT')).toEqual({ operatorId: 'u-1' });
  });

  it('SELF 档：患者资源一律拒绝（患者无归属操作人）', () => {
    expect(() => buildScopeWhere(user('SELF'), 'PATIENT')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NO_PATIENT_DATA_SCOPE }),
    );
  });

  it('NONE 档：禁止患者相关数据', () => {
    expect(() => buildScopeWhere(user('NONE'), 'PATIENT')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NO_PATIENT_DATA_SCOPE }),
    );
  });

  it('NONE 档：设备管理员仍可管理设备台账', () => {
    expect(buildScopeWhere(user('NONE'), 'DEVICE')).toEqual({ departmentId: 'd-endo' });
  });

  it('未知资源类型按最小权限拒绝，避免静默放行', () => {
    expect(() => buildScopeWhere(user('DEPARTMENT'), 'UNKNOWN' as never)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.NO_PATIENT_DATA_SCOPE }),
    );
  });
});

describe('assertInScope', () => {
  it('同科室放行', () => {
    expect(() => assertInScope(user('DEPARTMENT'), 'PATIENT', { departmentId: 'd-endo' })).not.toThrow();
  });

  it('跨科室抛 30002（审计按越权统计）', () => {
    expect(() => assertInScope(user('DEPARTMENT'), 'PATIENT', { departmentId: 'd-cardio' })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.CROSS_DEPARTMENT_DENIED }),
    );
  });

  it('数据不存在抛 40001，不泄露存在性', () => {
    expect(() => assertInScope(user('DEPARTMENT'), 'PATIENT', null)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.PATIENT_NOT_FOUND }),
    );
  });

  it('SELF 档访问他人审计记录抛 30002', () => {
    expect(() => assertInScope(user('SELF'), 'AUDIT', { operatorId: 'u-other' })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.CROSS_DEPARTMENT_DENIED }),
    );
  });

  it('SELF 档访问本人审计记录放行', () => {
    expect(() => assertInScope(user('SELF'), 'AUDIT', { operatorId: 'u-1' })).not.toThrow();
  });

  it('ALL 档一律放行', () => {
    expect(() => assertInScope(user('ALL'), 'PATIENT', { departmentId: 'd-cardio' })).not.toThrow();
  });
});

describe('canAccessResource', () => {
  it('设备管理员不能访问患者数据但可访问设备', () => {
    const admin = user('NONE');
    expect(canAccessResource(admin, 'PATIENT')).toBe(false);
    expect(canAccessResource(admin, 'DEVICE')).toBe(true);
  });
});
