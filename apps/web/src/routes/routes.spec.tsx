import type { PermissionCode } from '@gc/shared';
import { describe, expect, it } from 'vitest';
import { MENU_GROUPS, buildMenuTree } from './menu';
import type { AppRoute, MenuNode } from './menu';

/** 构造一个 hasPermission：集合内的权限点返回 true（模拟某角色） */
function allow(perms: string[]): (permission: PermissionCode) => boolean {
  const set = new Set(perms);
  return (permission) => set.has(permission);
}

const childLabels = (node: MenuNode): string[] =>
  (node.children ?? []).map((child) => String(child.label));

/** 自定义路由数据：覆盖分组、剪枝、平级模块等逻辑，不依赖真实页面组件 */
const routes: AppRoute[] = [
  { path: '/inpatient/ward', label: '虚拟病区', menuGroup: ['住院管理'], permissions: ['ward:view' as PermissionCode], element: null },
  { path: '/inpatient/patients', label: '患者管理', menuGroup: ['住院管理'], permissions: ['patient:view' as PermissionCode], element: null },
  { path: '/inpatient/alerts', label: '预警管理', menuGroup: ['住院管理'], permissions: ['alert:view' as PermissionCode], element: null },
  { path: '/devices/list', label: '设备列表', menuGroup: ['设备管理'], permissions: ['device:view' as PermissionCode], element: null },
  { path: '/devices/control', label: '质控液管理', menuGroup: ['设备管理'], permissions: ['device:manage' as PermissionCode], element: null },
  { path: '/quality/records', label: '质控记录', menuGroup: ['质控管理'], permissions: ['quality:view' as PermissionCode], element: null },
  { path: '/quality/analysis', label: '质控分析', menuGroup: ['质控管理'], permissions: ['quality:view' as PermissionCode], element: null },
  { path: '/system/basic', label: '基础设置', menuGroup: ['系统管理'], permissions: ['system:manage' as PermissionCode], element: null },
  { path: '/staff/roles', label: '角色权限管理', menuGroup: ['人员管理'], permissions: ['role:manage' as PermissionCode], element: null },
];

describe('buildMenuTree（菜单与路由守卫同源）', () => {
  it('全权限：5 顶级分组；住院管理下属虚拟病区/患者管理/预警管理', () => {
    const { items } = buildMenuTree(routes, () => true);
    const labels = items.map((i) => String(i.label));
    expect(labels).toEqual(
      expect.arrayContaining(['住院管理', '设备管理', '质控管理', '系统管理', '人员管理']),
    );

    const inpatient = items.find((i) => String(i.label) === '住院管理')!;
    expect(childLabels(inpatient)).toEqual(['虚拟病区', '患者管理', '预警管理']);

    expect(MENU_GROUPS).toHaveLength(5);
  });

  it('零权限角色：所有分组被剪枝，菜单为空', () => {
    const { items } = buildMenuTree(routes, () => false);
    expect(items.map((i) => String(i.label))).toEqual([]);
  });

  it('护士视角：系统/人员管理隐藏；质控管理可见', () => {
    const nurse = allow([
      'patient:view',
      'device:view',
      'ward:view',
      'alert:view',
      'quality:view',
    ]);
    const { items } = buildMenuTree(routes, nurse);
    const labels = items.map((i) => String(i.label));

    expect(labels).not.toContain('人员管理');
    expect(labels).not.toContain('系统管理');
    expect(labels).toContain('质控管理'); // 护士有 quality:view

    const inpatient = items.find((i) => String(i.label) === '住院管理')!;
    expect(childLabels(inpatient)).toEqual(['虚拟病区', '患者管理', '预警管理']);

    const device = items.find((i) => String(i.label) === '设备管理')!;
    // 设备列表需要 device:view（护士有），质控液管理需要 device:manage（护士无）
    expect(childLabels(device)).toEqual(['设备列表']);
  });

  it('系统管理员视角：全部分组可见（含系统管理、人员管理）', () => {
    const admin = allow([
      'ward:view',
      'patient:view',
      'device:view',
      'device:manage',
      'system:manage',
      'role:manage',
    ]);
    const { items } = buildMenuTree(routes, admin);
    const labels = items.map((i) => String(i.label));
    expect(labels).toEqual(
      expect.arrayContaining(['住院管理', '设备管理', '系统管理', '人员管理']),
    );
  });
});
