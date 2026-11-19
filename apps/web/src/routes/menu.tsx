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
 * 菜单层级用 `menuGroup` 表达（顶级大模块 → 可选的中分组），仅影响菜单渲染。
 * 路由本身以 `path` 唯一定位；**菜单可见的路由始终是顶层扁平的**——
 * `children`（如患者详情页的 5 个内容页）是页面内部的嵌套路由，一律不带 `label`，不进菜单。
 */
/** 路由项的公共字段（`path` / `index` 在下面的联合分支里单独约束） */
interface AppRouteBase {
  element: ReactNode;
  /** 有值才出现在侧边菜单 */
  label?: string;
  icon?: ComponentType;
  /** 所需权限点（任一满足即可进入）；不填 = 所有已登录用户可访问 */
  permissions?: PermissionCode[];
  /** 菜单层级：['顶级大模块'] 或 ['顶级大模块', '中分组']；缺省 = 一级菜单 */
  menuGroup?: string[];
  /**
   * 嵌套子路由，对应 React Router v6 `<Route>` 的 children。
   *
   * 子路由渲染在父 `element` 的 `<Outlet/>` 内，因此**天然继承父级守卫**，
   * 不必重复声明 `permissions`；也一律不写 `label`/`menuGroup`，
   * 否则会被 `buildMenuTree` 当成菜单项收进去（详情页的子页不该出现在侧栏）。
   */
  children?: AppRoute[];
}

/**
 * 路由项。
 *
 * 用**可辨识联合**而不是把 `path` 直接改成可选：普通路由的 `path` 保持必填，
 * 不削弱既有全部路由的类型约束；只有 index 路由能省略 `path`，且必须显式写 `index: true`。
 * 这样"漏写 path"会直接编译报错，而不是静默变成一条匹配不到任何东西的无效路由。
 */
export type AppRoute =
  | (AppRouteBase & { path: string; index?: false })
  | (AppRouteBase & { path?: undefined; index: true });

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
 * - **只遍历顶层，不递归 `route.children`**：子路由是页面内部路由（如患者详情的 5 个内容页），
 *   按约定不带 `label`，本就不该进菜单；不递归也避免了"给子路由误加 label 就冒出菜单项"的隐患
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
    // index 路由没有 path，本就无法生成菜单项；与"无 label 不进菜单"同为跳过条件。
    // 取到局部常量后，下面的 route.path 均已被收窄为 string。
    const path = route.path;
    if (!route.label || !path) {
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
        key: path,
        label: route.label,
        icon: route.icon ? <route.icon /> : undefined,
        path,
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
      key: path,
      label: route.label,
      icon: route.icon ? <route.icon /> : undefined,
      path,
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
