import { ROLE_CODE } from '@gc/shared';
import type { RoleCode } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';

/**
 * 患者表单下拉数据源（添加/编辑患者、办理住院弹框共用，P2-6 抽取）。
 *
 * 为什么抽公共模块：办理住院弹框要求「科室/责任医生/责任护士的展示逻辑与
 * 数据源和添加患者弹框一致」（2026-11-26 裁定 1b）。复制第二份过滤逻辑
 * 必然漂移（shared-package 规则 3 同理），故从 PatientFormFields 抽出。
 */

/** 责任护士候选角色：护士 + 护士长（与 DY-OPERATOR 口径一致） */
export const NURSE_ROLE_CODES: RoleCode[] = [ROLE_CODE.NURSE, ROLE_CODE.HEAD_NURSE];

/** 按数据范围收敛科室下拉，避免选到无权的科室 */
export function filterDepartments(
  departments: DepartmentOption[],
  dataScope: string | undefined,
  departmentId: string | undefined,
): DepartmentOption[] {
  if (dataScope === 'ALL') {
    return departments;
  }
  if (dataScope === 'NONE' || !departmentId) {
    return [];
  }
  return departments.filter((item) => item.id === departmentId);
}

/** 医护下拉：按科室联动，并限定角色 */
export function filterStaff(
  staff: StaffOption[],
  departmentId: string | undefined,
  roles: RoleCode[],
): StaffOption[] {
  if (!departmentId) {
    return [];
  }
  return staff.filter(
    (item) =>
      item.departmentId === departmentId && roles.some((role) => item.roleCodes.includes(role)),
  );
}
