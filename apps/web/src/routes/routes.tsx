import {
  AlertOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  DesktopOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  MedicineBoxOutlined,
  PieChartOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { PERMISSION } from '@gc/shared';
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import ForbiddenPage from '@/pages/Forbidden';
import PlaceholderPage from '@/pages/Placeholder';
import PatientManagementPage from '@/pages/inpatient/patients';
import VirtualWardPage from '@/pages/inpatient/virtual-ward';
import PatientDetailPage from '@/pages/inpatient/patient-detail';
import DetailFallbackRedirect from '@/pages/inpatient/patient-detail/DetailFallbackRedirect';
import DetailPlaceholder from '@/pages/inpatient/patient-detail/DetailPlaceholder';
import GlucoseRecordTab from '@/pages/inpatient/patient-detail/GlucoseRecordTab';
import GlucoseReportTab from '@/pages/inpatient/patient-detail/GlucoseReportTab';
import { DETAIL_ROUTE_PATH, DETAIL_TAB_PATH } from '@/pages/inpatient/patient-detail/detail-tabs';
import type { AppRoute } from './menu';

export type { AppRoute } from './menu';
export { MENU_GROUPS, buildMenuTree } from './menu';

/**
 * 路由与菜单的**唯一数据源**（菜单逻辑见 `menu.tsx`）。
 *
 * 为什么集中：菜单与路由守卫必须同源——若两处各配一份，
 * 很容易出现"菜单里藏了入口、但路由没守"（或反过来）的越权入口。
 * 新增页面只改这里：有 `label/icon` 才会出现在菜单，有 `permissions` 才会被守卫检查。
 */
const ph = (title: string, note: string): ReactNode => (
  <PlaceholderPage title={title} note={note} />
);

export const APP_ROUTES: AppRoute[] = [
  // 首页重定向：登录后默认进入「住院管理 - 患者管理」（工作台已移除）
  {
    path: '/',
    element: <Navigate to="/inpatient/patients" replace />,
  },

  // ===== 住院管理 =====
  {
    path: '/inpatient/ward',
    label: '虚拟病区',
    icon: ApartmentOutlined,
    menuGroup: ['住院管理'],
    permissions: [PERMISSION.WARD_VIEW],
    element: <VirtualWardPage />,
  },
  {
    path: '/inpatient/patients',
    label: '患者管理',
    icon: UserOutlined,
    menuGroup: ['住院管理'],
    // 住院/出院任一权限即可进入；页面内再按权限渲染 Tab
    permissions: [PERMISSION.PATIENT_INPATIENT_VIEW, PERMISSION.PATIENT_DISCHARGED_VIEW],
    element: <PatientManagementPage />,
  },
  {
    // 患者详情：无 label/icon/menuGroup → 不进菜单（buildMenuTree 跳过无 label 项）；
    // 守卫与后端详情接口一致（PATIENT_VIEW）。React Router 按特异性排序，与 /inpatient/patients 不冲突。
    //
    // 5 个内容页是**嵌套子路由**（R10），渲染在本 element 的 <Outlet/> 内 → 天然继承上面的守卫，
    // 故子路由不重复声明 permissions（父级判 403 时 Outlet 根本不渲染）；
    // 也一律不带 label/menuGroup，否则会冒出菜单项。
    // 子路径全部引用 detail-tabs.ts 常量，与 PatientDetailTabs 的高亮派生同源，禁止写字面量。
    path: DETAIL_ROUTE_PATH,
    permissions: [PERMISSION.PATIENT_VIEW],
    element: <PatientDetailPage />,
    children: [
      // 裸详情 URL → 默认落「血糖数据 → 血糖报告」（需求 1）。
      // 正常入口不经过这里：两处 goDetail 直接跳 .../glucose/report，避开 replace 覆盖 history 的风险
      { index: true, element: <DetailFallbackRedirect /> },
      { path: DETAIL_TAB_PATH.basic, element: <DetailPlaceholder label="基本信息" /> },
      { path: DETAIL_TAB_PATH.admission, element: <DetailPlaceholder label="出入院记录" /> },
      { path: DETAIL_TAB_PATH.glucoseReport, element: <GlucoseReportTab /> },
      // 血糖记录（R27）：占位已替换为正式页面；趋势图仍保持占位且不发请求（R2），后续开发只需替换 element
      { path: DETAIL_TAB_PATH.glucoseRecord, element: <GlucoseRecordTab /> },
      { path: DETAIL_TAB_PATH.glucoseTrend, element: <DetailPlaceholder label="趋势图" /> },
      // 兜底：没有它，未知子路径会让 <Outlet/> 渲染 null（Tab 栏在、内容区空白、无 Tab 高亮）
      { path: '*', element: <DetailFallbackRedirect /> },
    ],
  },
  {
    path: '/inpatient/alerts',
    label: '预警管理',
    icon: AlertOutlined,
    menuGroup: ['住院管理'],
    permissions: [PERMISSION.ALERT_VIEW],
    element: ph('预警管理', '需实现阈值判定与预警列表（P4）'),
  },

  // ===== 设备管理 =====
  {
    path: '/devices/list',
    label: '设备列表',
    icon: DesktopOutlined,
    menuGroup: ['设备管理'],
    permissions: [PERMISSION.DEVICE_VIEW],
    element: ph('设备列表', '需实现设备注册、绑定患者、状态与校准记录（P5）'),
  },
  {
    path: '/devices/strips',
    label: '试纸管理',
    icon: FileTextOutlined,
    menuGroup: ['设备管理'],
    permissions: [PERMISSION.DEVICE_VIEW],
    element: ph('试纸管理', '需实现试纸批次与有效期管理（P5）'),
  },
  {
    path: '/devices/control-solution',
    label: '质控液管理',
    icon: MedicineBoxOutlined,
    menuGroup: ['设备管理'],
    permissions: [PERMISSION.DEVICE_MANAGE],
    element: ph('质控液管理', '需实现质控液批次与开瓶效期（P5）'),
  },

  // ===== 质控管理 =====
  {
    path: '/quality/records',
    label: '质控记录',
    icon: FileDoneOutlined,
    menuGroup: ['质控管理'],
    permissions: [PERMISSION.QUALITY_VIEW],
    element: ph('质控记录', '需实现质控测量与记录（P5）'),
  },
  {
    path: '/quality/analysis',
    label: '质控分析',
    icon: PieChartOutlined,
    menuGroup: ['质控管理'],
    permissions: [PERMISSION.QUALITY_VIEW],
    element: ph('质控分析', '需实现质控规则与失控分析（P5）'),
  },

  // ===== 系统管理 =====
  {
    path: '/system/target-periods',
    label: '目标时段设置',
    icon: ClockCircleOutlined,
    menuGroup: ['系统管理'],
    permissions: [PERMISSION.SYSTEM_MANAGE],
    element: ph('目标时段设置', '需实现血糖目标范围与时段配置'),
  },
  {
    path: '/system/basic',
    label: '基础设置',
    icon: SettingOutlined,
    menuGroup: ['系统管理'],
    permissions: [PERMISSION.SYSTEM_MANAGE],
    element: ph('基础设置', '需实现科室/字典等基础配置'),
  },
  {
    path: '/system/logs',
    label: '系统日志',
    icon: FileSearchOutlined,
    menuGroup: ['系统管理'],
    permissions: [PERMISSION.AUDIT_VIEW],
    element: ph('系统日志', '需对接审计表查询与导出'),
  },

  // ===== 人员管理 =====
  {
    path: '/staff/medical',
    label: '医护人员管理',
    icon: TeamOutlined,
    menuGroup: ['人员管理'],
    permissions: [PERMISSION.STAFF_VIEW],
    element: ph('医护人员管理', '需实现医护人员档案与科室归属'),
  },
  {
    path: '/staff/roles',
    label: '角色权限管理',
    icon: SafetyOutlined,
    menuGroup: ['人员管理'],
    permissions: [PERMISSION.ROLE_MANAGE],
    element: ph('角色权限管理', '需实现角色与权限点配置'),
  },
];

/** 无权限时的落地页内容（守卫内部渲染，不作为独立路由暴露） */
export const FORBIDDEN_ELEMENT = <ForbiddenPage />;
