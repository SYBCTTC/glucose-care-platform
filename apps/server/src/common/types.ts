import { ROLE_PERMISSIONS } from '@gc/shared';
import type { DataScope, PermissionCode, ResourceType, RoleCode } from '@gc/shared';

/** 通过 JWT 校验后注入 request.user 的用户信息 */
export interface AuthenticatedUser {
  userId: string;
  username: string;
  displayName: string;
  departmentId: string;
  departmentName: string;
  /** 已展开的权限点集合，后端每次请求都以此为准做校验 */
  permissions: PermissionCode[];
  /** 用户所属角色（多角色） */
  roles: RoleCode[];
  /** 数据范围：决定能看哪些行，功能权限之外的第二道边界 */
  dataScope: DataScope;
  /**
   * 首次登录/被重置后必须修改密码（等保：口令定期更换）。
   * 为 true 时除改密、登出、查看本人信息外的接口一律拒绝（20005）。
   * 取 JWT 快照而非实时查库：改密后旧令牌仍为 true，可顺带挡住旧令牌继续使用。
   */
  mustChangePassword: boolean;
  /** 权限版本（P2 起用于变更即时失效；当前由 user.updatedAt 派生） */
  permissionVersion?: string;
}

/** `/auth/profile` 返回：认证信息 + 账号自身字段（前端个人资料弹窗用） */
export interface UserProfile extends AuthenticatedUser {
  /** 最近一次登录时间（ISO），null 表示从未登录 */
  lastLoginAt: string | null;
}

export interface JwtPayload {
  /** userId */
  sub: string;
  username: string;
  displayName: string;
  departmentId: string;
  departmentName: string;
  permissions: PermissionCode[];
  /**
   * 过渡期字段（方案 B 落地后移除）：
   * 当前 JWT 仍内嵌权限与数据范围，P2 将瘦身为仅 sub + pv，权限改由服务端缓存解析。
   */
  roles: RoleCode[];
  dataScope: DataScope;
  /** 登录时快照：为 true 时强制改密期间只放行改密相关接口 */
  mustChangePassword: boolean;
}

/** 审计结果 */
export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';

/** 数据权限：待校验的单行数据所需字段 */
export interface ScopeRow {
  departmentId?: string | null;
  operatorId?: string | null;
}

/** 资源 → 是否涉及患者隐私 */
export function isPatientScoped(resource: ResourceType): boolean {
  return resource === 'PATIENT';
}

/** 仅用于文档/自测：角色默认权限（与共享包保持一致） */
export const DEFAULT_ROLE_PERMISSIONS = ROLE_PERMISSIONS;
