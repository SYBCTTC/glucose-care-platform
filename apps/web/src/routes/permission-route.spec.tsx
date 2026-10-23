import { PERMISSION } from '@gc/shared';
import type { PermissionCode } from '@gc/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PermissionRoute from './PermissionRoute';
import type { Profile } from '@/store/auth';

/**
 * 路由守卫单测。
 *
 * 两条环境约束决定了这里的写法：
 * 1. 本机批量删除守卫拦截了 jsdom / @testing-library/react 的安装
 *    （`node_modules/jsdom` 1072 个文件超阈值需人工确认），故用
 *    `renderToStaticMarkup` 在 node 环境断言渲染分支，无需 DOM、不新增依赖；
 * 2. SSR 下 zustand 走 `getServerSnapshot`（返回**初始**状态），`setState` 对渲染无效，
 *    因此用模块 mock 直接注入 profile。
 * 装好 jsdom 后可在 vite.config.ts 打开 `environment: 'jsdom'` 并改用 RTL + setState 写法。
 */

const mockStore = vi.hoisted(() => {
  const state = {
    profile: null as Profile | null,
    hasPermission: (permission: PermissionCode): boolean =>
      state.profile?.permissions.includes(permission) ?? false,
  };
  return { state };
});

vi.mock('@/store/auth', () => ({
  useAuthStore: (selector?: (s: typeof mockStore.state) => unknown) =>
    selector ? selector(mockStore.state) : mockStore.state,
}));

function makeProfile(permissions: PermissionCode[]): Profile {
  return {
    userId: 'u1',
    username: 'nurse.li',
    displayName: '李护士',
    departmentId: 'd1',
    departmentName: '内分泌科',
    permissions,
    roles: ['NURSE'],
    dataScope: 'DEPARTMENT',
    mustChangePassword: false,
    lastLoginAt: null,
  };
}

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

afterEach(() => {
  mockStore.state.profile = null;
});

describe('PermissionRoute', () => {
  it('无所需权限 → 渲染 403 页，不渲染子内容', () => {
    mockStore.state.profile = makeProfile([PERMISSION.DEVICE_VIEW]);
    const html = render(
      <PermissionRoute permissions={[PERMISSION.PATIENT_VIEW]}>
        <div>患者管理内容</div>
      </PermissionRoute>,
    );
    expect(html).toContain('无访问权限');
    expect(html).toContain('返回工作台');
    expect(html).not.toContain('患者管理内容');
  });

  it('有所需权限 → 渲染子内容', () => {
    mockStore.state.profile = makeProfile([PERMISSION.PATIENT_VIEW]);
    const html = render(
      <PermissionRoute permissions={[PERMISSION.PATIENT_VIEW]}>
        <div>患者管理内容</div>
      </PermissionRoute>,
    );
    expect(html).toContain('患者管理内容');
    expect(html).not.toContain('无访问权限');
  });

  it('多权限点取"任一满足"', () => {
    mockStore.state.profile = makeProfile([PERMISSION.DEVICE_VIEW]);
    const html = render(
      <PermissionRoute permissions={[PERMISSION.PATIENT_VIEW, PERMISSION.DEVICE_VIEW]}>
        <div>混合页面</div>
      </PermissionRoute>,
    );
    expect(html).toContain('混合页面');
  });

  it('未声明权限 → 所有已登录用户可访问', () => {
    mockStore.state.profile = makeProfile([]);
    const html = render(
      <PermissionRoute>
        <div>工作台内容</div>
      </PermissionRoute>,
    );
    expect(html).toContain('工作台内容');
  });

  it('权限未加载（profile 为空）→ 显示加载态而不是 403，避免刷新时误判', () => {
    mockStore.state.profile = null;
    const html = render(
      <PermissionRoute permissions={[PERMISSION.PATIENT_VIEW]}>
        <div>患者管理内容</div>
      </PermissionRoute>,
    );
    expect(html).not.toContain('无访问权限');
    expect(html).not.toContain('患者管理内容');
    expect(html).toContain('ant-spin');
  });

  it('403 页展示当前账号与已授予权限点，便于报修', () => {
    mockStore.state.profile = makeProfile([PERMISSION.DEVICE_VIEW]);
    const html = render(
      <PermissionRoute permissions={[PERMISSION.PATIENT_VIEW]}>
        <div>患者管理内容</div>
      </PermissionRoute>,
    );
    expect(html).toContain('李护士');
    expect(html).toContain(PERMISSION.DEVICE_VIEW);
  });
});
