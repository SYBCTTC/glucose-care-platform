import { ERROR_CODES } from '@gc/shared';
import type { ResourceType } from '@gc/shared';
import { BusinessException } from '../exceptions/business.exception';
import type { AuthenticatedUser, ScopeRow } from '../types';

/**
 * 数据权限统一出口（唯一权威实现）。
 *
 * 规则见 docs/PERMISSION-DESIGN.md：
 * - ALL        全院：不加限制
 * - DEPARTMENT 本科室：按资源所属科室过滤
 * - SELF       仅本人操作的数据：按 operatorId 过滤（患者资源不适用，一律拒绝）
 * - NONE       无患者数据：禁止访问 PATIENT（设备管理员），其余资源按科室
 *
 * 强制约定：service 中**禁止**手写 `x.departmentId !== user.departmentId` 之类的判断，
 * 必须调用本文件的方法，否则新模块极易漏掉数据权限。
 */

/** 生成 Prisma where 条件；返回 {} 表示不做限制 */
export function buildScopeWhere(
  user: AuthenticatedUser,
  resource: ResourceType,
): Record<string, unknown> {
  const { dataScope, departmentId, userId } = user;

  if (dataScope === 'ALL') {
    return {};
  }

  if (dataScope === 'NONE' && resource === 'PATIENT') {
    throw new BusinessException(ERROR_CODES.NO_PATIENT_DATA_SCOPE);
  }

  switch (resource) {
    case 'PATIENT':
      // 患者本身没有"归属操作人"，SELF 档不授予患者数据
      if (dataScope === 'SELF') {
        throw new BusinessException(ERROR_CODES.NO_PATIENT_DATA_SCOPE);
      }
      return { departmentId };

    case 'DEVICE':
      // 设备台账按科室归属；设备无归属操作人，SELF 退化为本科室
      return { departmentId };

    case 'AUDIT':
      return dataScope === 'SELF' ? { operatorId: userId } : { departmentId };

    case 'STAFF':
      // 人员按科室归属；SELF 档退化为本科室（与设备一致）
      return { departmentId };

    case 'DEPARTMENT':
      // 科室为院内基础组织数据，全院可见，不做数据范围限制
      return {};

    default:
      // 未知资源类型：按最小权限拒绝，避免新增资源后静默放行
      throw new BusinessException(ERROR_CODES.NO_PATIENT_DATA_SCOPE);
  }
}

/**
 * 单行数据越权校验（用于"先查后判"的场景，如按 id 更新/删除）。
 * 越权属安全事件，抛 30002 / 30006，由审计拦截器记录为 DENIED。
 */
export function assertInScope(
  user: AuthenticatedUser,
  resource: ResourceType,
  row: ScopeRow | null | undefined,
): void {
  if (!row) {
    throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
  }

  if (user.dataScope === 'ALL') {
    return;
  }

  // 科室为院内基础组织数据，全院可见，不做单行越权拦截
  if (resource === 'DEPARTMENT') {
    return;
  }

  if (user.dataScope === 'NONE' && resource === 'PATIENT') {
    throw new BusinessException(ERROR_CODES.NO_PATIENT_DATA_SCOPE);
  }

  if (user.dataScope === 'SELF') {
    if (resource === 'PATIENT') {
      throw new BusinessException(ERROR_CODES.NO_PATIENT_DATA_SCOPE);
    }
    if (row.operatorId !== user.userId) {
      throw new BusinessException(ERROR_CODES.CROSS_DEPARTMENT_DENIED);
    }
    return;
  }

  if (row.departmentId !== user.departmentId) {
    throw new BusinessException(ERROR_CODES.CROSS_DEPARTMENT_DENIED);
  }
}

/** 当前用户是否可访问该类资源（用于接口前置快速失败，如导出前的提示） */
export function canAccessResource(user: AuthenticatedUser, resource: ResourceType): boolean {
  if (user.dataScope === 'ALL') {
    return true;
  }
  if (user.dataScope === 'NONE' && resource === 'PATIENT') {
    return false;
  }
  if (user.dataScope === 'SELF' && resource === 'PATIENT') {
    return false;
  }
  return true;
}
