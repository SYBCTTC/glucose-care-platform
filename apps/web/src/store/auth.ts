import { create } from 'zustand';
import { http, setToken } from '@/api/client';
import { useCommonDataStore } from '@/store/common-data';
import type { DataScope, PermissionCode, RoleCode } from '@gc/shared';

export interface Profile {
  userId: string;
  username: string;
  displayName: string;
  departmentId: string;
  departmentName: string;
  permissions: PermissionCode[];
  /** 多角色 */
  roles: RoleCode[];
  /** 数据范围：前端仅用于提示，真实过滤在服务端 */
  dataScope: DataScope;
  /** 首次登录/被重置后必须改密：为 true 时强制弹窗且服务端拒绝其他接口 */
  mustChangePassword: boolean;
  /** 最近登录时间（ISO），null 表示从未登录 */
  lastLoginAt?: string | null;
  /** 权限版本，权限变更时服务端会使其失效 */
  permissionVersion?: string;
}

interface AuthState {
  profile: Profile | null;
  login: (username: string, password: string) => Promise<void>;
  loadProfile: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: PermissionCode) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  profile: null,

  login: async (username, password) => {
    const data = await http.post<{ accessToken: string; expiresAt: string; profile: Profile }>(
      '/auth/login',
      {
        username,
        password,
      },
    );
    setToken(data.accessToken);
    set({ profile: data.profile });
  },

  /** 应用启动时拉取当前用户与权限点；失败（401）会由 client 统一跳登录 */
  loadProfile: async () => {
    const profile = await http.get<Profile>('/auth/profile');
    set({ profile });
  },

  /**
   * 修改密码。成功后由调用方负责登出并跳登录页——
   * 服务端当前无法让旧 token 立即失效（P2 权限版本机制落地后解决）。
   */
  changePassword: async (oldPassword, newPassword) => {
    await http.post('/auth/change-password', {
      oldPassword,
      newPassword,
      confirmPassword: newPassword,
    });
  },

  logout: async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      set({ profile: null });
      localStorage.removeItem('gc_access_token');
      // 清空公共数据缓存，避免切换账号后看到上一个账号的科室/人员/设备
      useCommonDataStore.getState().reset();
    }
  },

  /** 前端显隐仅是体验，安全边界在后端 PermissionsGuard 与数据权限过滤 */
  hasPermission: (permission) => get().profile?.permissions.includes(permission) ?? false,
}));