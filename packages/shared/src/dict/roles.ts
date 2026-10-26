/** 系统角色。权限模型见 docs/ARCHITECTURE.md */
export const ROLE_CODE = {
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  HEAD_NURSE: 'NURSE_HEAD',
  DEVICE_ADMIN: 'DEVICE_ADMIN',
  SYS_ADMIN: 'SYS_ADMIN',
} as const;
export type RoleCode = (typeof ROLE_CODE)[keyof typeof ROLE_CODE];

export const ROLE_LABELS: Record<RoleCode, string> = {
  DOCTOR: '医生',
  NURSE: '护士',
  NURSE_HEAD: '护士长',
  DEVICE_ADMIN: '设备管理员',
  SYS_ADMIN: '系统管理员',
};

/**
 * 权限点。前端用于菜单与按钮显隐，后端用于强制校验（前端显隐仅是体验）。
 */
export const PERMISSION = {
  PATIENT_VIEW: 'patient:view',
  /** 患者建档（新增患者）；与编辑/归档等管理动作分离，便于只授予建档权限 */
  PATIENT_CREATE: 'patient:create',
  /** 患者信息编辑（修改床号/责任医生等）；与 MANAGE（归档等）分离，便于单独授予 */
  PATIENT_UPDATE: 'patient:update',
  PATIENT_MANAGE: 'patient:manage',
  /** 住院患者 Tab 可见/可查 */
  PATIENT_INPATIENT_VIEW: 'patient:inpatient:view',
  /** 出院患者 Tab 可见/可查 */
  PATIENT_DISCHARGED_VIEW: 'patient:discharged:view',
  DEVICE_VIEW: 'device:view',
  DEVICE_MANAGE: 'device:manage',
  AUDIT_VIEW: 'audit:view',
  SYSTEM_MANAGE: 'system:manage',
  // 住院管理
  WARD_VIEW: 'ward:view',
  ALERT_VIEW: 'alert:view',
  // 质控管理
  QUALITY_VIEW: 'quality:view',
  QUALITY_MANAGE: 'quality:manage',
  // 人员管理
  STAFF_VIEW: 'staff:view',
  STAFF_MANAGE: 'staff:manage',
  ROLE_MANAGE: 'role:manage',
  // 公共数据（登录后一次性加载，供下拉/默认值使用）
  DEPARTMENT_VIEW: 'department:view',
  OPERATOR_VIEW: 'staff:lookup',
} as const;
export type PermissionCode = (typeof PERMISSION)[keyof typeof PERMISSION];

/**
 * 角色 → 权限点映射。
 * 注意：设备管理员默认不含任何患者数据权限。
 */
export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  DOCTOR: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.WARD_VIEW,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
  ],
  NURSE: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_UPDATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.WARD_VIEW,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
  ],
  NURSE_HEAD: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.PATIENT_UPDATE,
    PERMISSION.PATIENT_MANAGE,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.WARD_VIEW,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
  ],
  DEVICE_ADMIN: [
    PERMISSION.DEVICE_VIEW,
    PERMISSION.DEVICE_MANAGE,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
  ],
  // 系统管理员：全权限点。不要在这里留"超管后门"式的隐式放行——
  // 权限一律用权限点显式表达，前后端同源，避免前后端两套判断不一致。
  SYS_ADMIN: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.PATIENT_UPDATE,
    PERMISSION.PATIENT_MANAGE,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.DEVICE_MANAGE,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.SYSTEM_MANAGE,
    PERMISSION.WARD_VIEW,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.STAFF_VIEW,
    PERMISSION.STAFF_MANAGE,
    PERMISSION.ROLE_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
  ],
};

/** 数据范围类型，决定数据权限过滤器的行为 */
export const DATA_SCOPE = {
  ALL: 'ALL',
  DEPARTMENT: 'DEPARTMENT',
  SELF: 'SELF',
  NONE: 'NONE',
} as const;
export type DataScope = (typeof DATA_SCOPE)[keyof typeof DATA_SCOPE];

/** 数据范围中文标签（前端顶栏提示"可见范围"用） */
export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  ALL: '全院',
  DEPARTMENT: '本科室',
  SELF: '仅本人',
  NONE: '无患者数据',
};

/** 角色 → 数据范围 */
export const ROLE_DATA_SCOPE: Record<RoleCode, DataScope> = {
  DOCTOR: DATA_SCOPE.DEPARTMENT,
  NURSE: DATA_SCOPE.DEPARTMENT,
  NURSE_HEAD: DATA_SCOPE.DEPARTMENT,
  DEVICE_ADMIN: DATA_SCOPE.NONE,
  SYS_ADMIN: DATA_SCOPE.ALL,
};

/**
 * 受数据权限约束的资源类型，作为服务端 `@RequireDataScope()` 的参数。
 * 新增资源类型时必须同时登记，否则数据权限不会生效。
 */
export const RESOURCE = {
  PATIENT: 'PATIENT',
  DEVICE: 'DEVICE',
  AUDIT: 'AUDIT',
  /** 人员（医护下拉）：按科室过滤 */
  STAFF: 'STAFF',
  /** 科室：院内基础组织数据，全院可见 */
  DEPARTMENT: 'DEPARTMENT',
} as const;
export type ResourceType = (typeof RESOURCE)[keyof typeof RESOURCE];

/** 涉及患者隐私的资源，NONE 档角色一律禁止访问 */
export const PATIENT_SCOPED_RESOURCES: ResourceType[] = [RESOURCE.PATIENT];

/** 数据范围宽松度：多角色时取最宽松的一档 */
const DATA_SCOPE_RANK: Record<DataScope, number> = {
  NONE: 0,
  SELF: 1,
  DEPARTMENT: 2,
  ALL: 3,
};

/**
 * 从角色码解析数据范围：多角色取最宽松档；无有效角色返回 NONE（最小权限兜底）。
 * 非法角色码直接忽略，避免脏数据扩大权限。
 */
export function resolveDataScope(roleCodes: string[]): DataScope {
  let result: DataScope = DATA_SCOPE.NONE;
  for (const code of roleCodes) {
    const scope = ROLE_DATA_SCOPE[code as RoleCode];
    if (!scope) {
      continue;
    }
    if (DATA_SCOPE_RANK[scope] > DATA_SCOPE_RANK[result]) {
      result = scope;
    }
  }
  return result;
}
