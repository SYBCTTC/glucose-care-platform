import { Spin } from 'antd';
import type { ReactNode } from 'react';
import type { PermissionCode } from '@gc/shared';
import ForbiddenPage from '@/pages/Forbidden';
import { useAuthStore } from '@/store/auth';

interface Props {
  /** 所需权限点，任一满足即可；不传 = 所有已登录用户可访问 */
  permissions?: PermissionCode[];
  children: ReactNode;
}

/**
 * 路由级权限守卫（前端第一道防线）。
 *
 * 定位：这是**体验**，不是安全边界——真正的边界是服务端 `PermissionsGuard`。
 * 但它必须存在：否则用户直接输入 URL 就能进入无权页面，
 * 看到一堆 403 提示却不知道原因，患者/设备管理页上线后更是明显的越权入口。
 *
 * 两个刻意的取舍：
 * 1. 权限未加载（`profile` 为空）时显示加载态而不是 403，避免刷新页面瞬间误判；
 * 2. 无权限渲染 403 页而**不跳登录**，与 `30004` 的语义一致（权限问题 ≠ 会话失效）。
 */
export default function PermissionRoute({ permissions, children }: Props) {
  const profile = useAuthStore((state) => state.profile);
  const hasPermission = useAuthStore((state) => state.hasPermission);

  if (!permissions?.length) {
    return <>{children}</>;
  }

  if (!profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  return permissions.some((permission) => hasPermission(permission)) ? (
    <>{children}</>
  ) : (
    <ForbiddenPage />
  );
}
