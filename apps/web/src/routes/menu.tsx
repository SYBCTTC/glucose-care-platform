import {
  ExperimentOutlined,
  HddOutlined,
  HeartOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { PermissionCode } from '@gc/shared';
import type { ComponentType, ReactNode } from 'react';

/**
 * 路由与菜单的**唯一数据源**中的"菜单相关"部分被抽离到此，
 * 以便菜单树构建函数可被纯 node 单测覆盖而不引入页面组件（页面会拖入 echarts 等浏览器依赖）。
 *
 * 为什么集中：菜单与路由守卫必须同源——若两处各配一份，
 * 很容易出现"菜单里藏了入口、但路由没守"（或反过来）的越权入口。
 * 新增页面只改 `routes.tsx` 的 APP_ROUTES：有 `label/icon` 才会出现在菜单，
 * 有 `permissions` 才会被守卫检查。
 *
 * 菜单层级用 `menuGroup` 表达（顶级大模块 → 可选的中分组），仅影响菜单渲染；
 * 路由本身始终扁平、由 `path` 唯一定位。
 */
export interface AppRoute {
  path: string;
  element: ReactNode;
  /** 有值才出现在侧边菜单 */
  label?: string;
  icon?: ComponentType;
  /** 所需权限点（任一满足即可进入）；不填 = 所有已登录用户可访问 */
  permissions?: PermissionCode[];
  /** 菜单层级：['顶级大模块'] 或 ['顶级大模块', '中分组']；缺省 = 一级菜单 */
  menuGroup?: string[];
}

/** 顶级大模块：决定菜单分组顺序与图标。无权限的分组会自动隐藏（见 buildMenuTree）。 */
export const MENU_GROUPS: { key: string; label: string; icon: ComponentType }[] = [
  { key: 'inpatient', label: '住院管理', icon: HeartOutlined },
  { key: 'device', label: '设备管理', icon: HddOutlined },
  { key: 'quality', label: '质控管理', icon: ExperimentOutlined },
  { key: 'system', label: '系统管理', icon: SettingOutlined },
  { key: 'staff', label: '人员管理', icon: TeamOutlined },
];

export interface MenuNode {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  path?: string;
  children?: MenuNode[];
}

/**
 * 由 APP_ROUTES 构建嵌套菜单树。
 * - 按 `menuGroup` 聚合为分组（顶级大模块 + 可选中分组）
 * - 无权限的菜单项不出现；最终无可展开子项的空分组会被剪枝（避免空菜单）
 * - 返回需要默认展开的分组 key（openKeys）
 *
 * 纯函数、无 DOM 依赖，单测见 `routes.spec.tsx`。
 */
export function buildMenuTree(
  routes: AppRoute[],
  hasPermission: (permission: PermissionCode) => boolean,
): { items: MenuNode[]; openKeys: string[] } {
  const root: MenuNode[] = [];
  const topGroups = new Map<string, MenuNode>();
  for (const group of MENU_GROUPS) {
    const node: MenuNode = {
      key: `group:${group.key}`,
      label: group.label,
      icon: group.icon ? <group.icon /> : undefined,
      children: [],
    };
    topGroups.set(group.label, node);
    root.push(node);
  }

  const openKeys: string[] = [];
  for (const route of routes) {
    if (!route.label) {
      continue;
    }
    if (route.permissions?.length && !route.permissions.some(hasPermission)) {
      continue;
    }
    const groups = route.menuGroup ?? [];
    let parent: MenuNode | null = groups.length ? topGroups.get(groups[0]) ?? null : null;
    if (!parent) {
      // 无分组：直接挂到一级（如未来的概览/首页路由）
      root.push({
        key: route.path,
        label: route.label,
        icon: route.icon ? <route.icon /> : undefined,
        path: route.path,
      });
      continue;
    }
    if (groups.length > 1) {
      let mid = parent.children!.find((child) => child.label === groups[1]);
      if (!mid) {
        mid = { key: `mid:${groups[1]}`, label: groups[1], children: [] };
        parent.children!.push(mid);
        openKeys.push(mid.key);
      }
      parent = mid;
    }
    parent.children!.push({
      key: route.path,
      label: route.label,
      icon: route.icon ? <route.icon /> : undefined,
      path: route.path,
    });
  }

  // 剪枝：递归删除空分组（包括无可见子项的顶级大模块）
  const prune = (nodes: MenuNode[]): MenuNode[] =>
    nodes
      .map((node) => ({
        ...node,
        children: node.children ? prune(node.children) : undefined,
      }))
      .filter((node) => !node.children || node.children.length > 0);

  const pruned = prune(root);
  for (const group of MENU_GROUPS) {
    openKeys.push(`group:${group.key}`);
  }
  return { items: pruned, openKeys };
}
