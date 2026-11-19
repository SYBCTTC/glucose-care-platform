import { Outlet, useLocation } from 'react-router-dom';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { layoutSize } from '@/styles/tokens';
import {
  GLUCOSE_TAB_PATH,
  MAIN_TAB_PATH,
  resolveDetailTab,
  type DetailGlucoseTab,
  type DetailMainTab,
  type DetailOutletContext,
} from './detail-tabs';
import { useDetailTabNavigate } from './useDetailTabNavigate';

/** 主 Tab（下划线高亮）。注意：此处"基本信息"是待实现的 Tab，与顶部基本信息区是两回事（决策 D4） */
const MAIN_TABS: TabItem[] = [
  { key: 'glucose', label: '血糖数据' },
  { key: 'basic', label: '基本信息' },
  { key: 'admission', label: '出入院记录' },
];

/** "血糖数据"下的子 Tab（背景色高亮） */
const GLUCOSE_SUB_TABS: TabItem[] = [
  { key: 'report', label: '血糖报告' },
  { key: 'record', label: '血糖记录' },
  { key: 'trend', label: '趋势图' },
];

/**
 * 详情页 Tabs 区（占满剩余空间）。
 *
 * **两层 Tab 均由 URL 驱动**（R10）：选中态从 `location.pathname` 派生、切换走路由，
 * 因此 5 个内容页（基本信息 / 出入院记录 / 血糖报告 / 血糖记录 / 趋势图）刷新后都停在原处。
 * 内容区由 `<Outlet/>` 渲染对应子路由；本组件不再持有 Tab 状态，
 * 也不再渲染占位 `Empty`——占位已下沉到各子路由的 `DetailPlaceholder`。
 *
 * ⚠️ `<Outlet/>` 必须留在这里：本组件只在壳（`index.tsx`）的 `data` 已加载分支内渲染，
 * 于是患者 403/404 时子路由根本不会挂载，报表请求也就不会发出
 * （既避免越权探测面与多余审计，也保住 Spin/Result 占位页）。
 * 把 `<Outlet/>` 提到壳的外层会同时破坏这两点。
 */
export default function PatientDetailTabs({
  outletContext,
}: {
  outletContext: DetailOutletContext;
}) {
  const { pathname } = useLocation();
  const navigateTab = useDetailTabNavigate();
  const { main, glucose } = resolveDetailTab(pathname);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Tabs
        items={MAIN_TABS}
        value={main}
        onChange={(key) => navigateTab(MAIN_TAB_PATH[key as DetailMainTab])}
        variant="underline"
      />
      {/* R21（2026-11-19 裁定）：子 Tabs 移出滚动区固定展示，内容区是唯一滚动容器。
          血糖报告页在内容区内再自行接管高度（表格 body 内滚），其余内容页照旧整体滚动 */}
      {main === 'glucose' ? (
        <div style={{ marginTop: layoutSize.cardGap, flexShrink: 0 }}>
          <Tabs
            items={GLUCOSE_SUB_TABS}
            value={glucose}
            onChange={(key) => navigateTab(GLUCOSE_TAB_PATH[key as DetailGlucoseTab])}
            variant="background"
          />
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          // 有子 Tabs 时内容紧随其下（保持原视觉间距 0）；无子 Tabs 时与主 Tab 拉开 cardGap
          marginTop: main === 'glucose' ? 0 : layoutSize.cardGap,
        }}
      >
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
