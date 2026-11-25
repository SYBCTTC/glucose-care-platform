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
  /** 办理住院：把出院患者重新转为住院（DISCHARGED → INPATIENT） */
  PATIENT_ADMIT: 'patient:admit',
  /**
   * 患者控糖目标编辑（各时段血糖上下限 + 低/高血糖预警值）。
   * **不复用** PATIENT_UPDATE：改控糖目标会改变该患者后续所有血糖的 resultType 判定结果，
   * 敏感度高于改床号/责任医生，需可单独授权与单独审计过滤（2026-11-25 裁定 H）。
   * 查看沿用 PATIENT_VIEW，不另设查看权限点。规格：docs/specs/patient-glucose-target.md §5.1
   */
  PATIENT_TARGET_UPDATE: 'patient:target:update',
  /** 添加血糖（手工录入血糖记录）；与患者编辑分离，便于只授予录入权限 */
  GLUCOSE_CREATE: 'glucose:create',
  /** 编辑血糖（修改已有血糖记录，R25）；与 create 分离，便于单独收权 */
  GLUCOSE_UPDATE: 'glucose:update',
  /** 作废血糖（软删除，R25）；比编辑更敏感，仅护士长/系统管理员（2026-11-20 裁定 Q8） */
  GLUCOSE_DELETE: 'glucose:delete',
  /** 血糖数据打印（R28）：打印按钮显隐 + 明文姓名接口 + 打印留痕接口共用（裁定 Q5/Q6） */
  GLUCOSE_PRINT: 'glucose:print',
  DEVICE_VIEW: 'device:view',
  DEVICE_MANAGE: 'device:manage',
  AUDIT_VIEW: 'audit:view',
  SYSTEM_MANAGE: 'system:manage',
  // 住院管理
  WARD_VIEW: 'ward:view',
  /** 虚拟病区操作（加入 / 移出患者）；与查看分离，便于将来只读授权 */
  WARD_MANAGE: 'ward:manage',
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
  /** 动态字典读取（公共数据，登录后一次性加载，全院可见） */
  DICT_VIEW: 'dict:view',
} as const;
export type PermissionCode = (typeof PERMISSION)[keyof typeof PERMISSION];

/**
 * 角色 → 权限点映射。
 * 注意：设备管理员默认不含任何患者数据权限。
 */
export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  DOCTOR: [
    PERMISSION.PATIENT_VIEW,
    // 医生可建档（2026-11-17 需求人决定）。数据范围仍是 DEPARTMENT，
    // 因此只能建本科室患者：PatientService.create 第一行即 assertInScope(PATIENT, {departmentId})，
    // 跨科室建档抛 30002 并记 DENIED 审计。未一并授予 PATIENT_UPDATE / PATIENT_ADMIT。
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    // 医生不授予 PATIENT_ADMIT：入院登记属护理/管理动作
    PERMISSION.DEVICE_VIEW,
    PERMISSION.WARD_VIEW,
    // 虚拟病区操作（2026-11-18 需求人裁定：医生/护士/护士长/系统管理员均可操作）。
    // 数据范围仍是 DEPARTMENT，只能加入本科室患者；跨科室抛 30002 并记 DENIED 审计。
    PERMISSION.WARD_MANAGE,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    // 患者控糖目标编辑（2026-11-25 裁定 H：医生/护士/护士长/系统管理员四角色均可）。
    // 数据范围仍是 DEPARTMENT，只能改本科室患者；跨科室抛 30002 并记 DENIED 审计。
    PERMISSION.PATIENT_TARGET_UPDATE,
    PERMISSION.GLUCOSE_CREATE,
    // R25 裁定 Q8：医生可编辑血糖（同 create 四角色）；**不授予** glucose:delete（删除属管理动作）
    PERMISSION.GLUCOSE_UPDATE,
    // R28 裁定 Q5：医生可打印血糖数据（同 create 四角色）
    PERMISSION.GLUCOSE_PRINT,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
    PERMISSION.DICT_VIEW,
  ],
  NURSE: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_UPDATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.PATIENT_ADMIT,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.WARD_VIEW,
    PERMISSION.WARD_MANAGE,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
    // 患者控糖目标编辑（2026-11-25 裁定 H）；数据范围 DEPARTMENT
    PERMISSION.PATIENT_TARGET_UPDATE,
    PERMISSION.GLUCOSE_CREATE,
    // R25 裁定 Q8：护士可编辑血糖；不授予 glucose:delete
    PERMISSION.GLUCOSE_UPDATE,
    // R28 裁定 Q5：护士可打印血糖数据
    PERMISSION.GLUCOSE_PRINT,
    PERMISSION.DICT_VIEW,
  ],
  NURSE_HEAD: [
    PERMISSION.PATIENT_VIEW,
    PERMISSION.PATIENT_CREATE,
    PERMISSION.PATIENT_INPATIENT_VIEW,
    PERMISSION.PATIENT_DISCHARGED_VIEW,
    PERMISSION.PATIENT_UPDATE,
    PERMISSION.PATIENT_MANAGE,
    PERMISSION.PATIENT_ADMIT,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.WARD_VIEW,
    PERMISSION.WARD_MANAGE,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
    // 患者控糖目标编辑（2026-11-25 裁定 H）；数据范围 DEPARTMENT
    PERMISSION.PATIENT_TARGET_UPDATE,
    PERMISSION.GLUCOSE_CREATE,
    // R25 裁定 Q8：护士长可编辑 + 可作废（删除属管理动作）
    PERMISSION.GLUCOSE_UPDATE,
    PERMISSION.GLUCOSE_DELETE,
    // R28 裁定 Q5：护士长可打印血糖数据
    PERMISSION.GLUCOSE_PRINT,
    PERMISSION.DICT_VIEW,
  ],
  DEVICE_ADMIN: [
    PERMISSION.DEVICE_VIEW,
    PERMISSION.DEVICE_MANAGE,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
    PERMISSION.DICT_VIEW,
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
    PERMISSION.PATIENT_ADMIT,
    PERMISSION.DEVICE_VIEW,
    PERMISSION.DEVICE_MANAGE,
    PERMISSION.AUDIT_VIEW,
    PERMISSION.SYSTEM_MANAGE,
    PERMISSION.WARD_VIEW,
    // SYS_ADMIN 的不变式是"含全部权限点"，新增权限点必须同步加到这里
    PERMISSION.WARD_MANAGE,
    PERMISSION.ALERT_VIEW,
    PERMISSION.QUALITY_VIEW,
    PERMISSION.QUALITY_MANAGE,
    PERMISSION.STAFF_VIEW,
    PERMISSION.STAFF_MANAGE,
    PERMISSION.ROLE_MANAGE,
    PERMISSION.DEPARTMENT_VIEW,
    PERMISSION.OPERATOR_VIEW,
    // 患者控糖目标编辑（2026-11-25 裁定 H）；SYS_ADMIN 不变式"含全部权限点"，同步授予
    PERMISSION.PATIENT_TARGET_UPDATE,
    PERMISSION.GLUCOSE_CREATE,
    // R25：SYS_ADMIN 不变式"含全部权限点"，新权限点必须同步加到这里
    PERMISSION.GLUCOSE_UPDATE,
    PERMISSION.GLUCOSE_DELETE,
    // R28 裁定 Q5：SYS_ADMIN 不变式"含全部权限点"，同步授予打印
    PERMISSION.GLUCOSE_PRINT,
    PERMISSION.DICT_VIEW,
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
  /** 动态字典：院内基础数据，全院可见 */
  DICT: 'DICT',
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
