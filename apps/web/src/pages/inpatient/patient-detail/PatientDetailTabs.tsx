import { useEffect, useState } from 'react';
import { Checkbox, message, theme } from 'antd';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import { layoutSize } from '@/styles/tokens';
import {
  DEFAULT_GLUCOSE_REPORT_DISPLAY,
  GLUCOSE_TAB_PATH,
  MAIN_TAB_PATH,
  resolveDetailTab,
  type DetailGlucoseTab,
  type DetailMainTab,
  type DetailOutletContext,
  type GlucoseReportDisplay,
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
 * R22 规则 1：报表展示项勾选（子 Tabs 同一水平线、紧跟其后）。
 * 规则 2：仅「血糖报告」子 Tab 渲染；文案为需求人指定的固定四项。
 */
const REPORT_DISPLAY_OPTIONS: { label: string; value: keyof GlucoseReportDisplay }[] = [
  { label: '常规血糖', value: 'normal' },
  { label: '强化血糖', value: 'intensive' },
  { label: '检测时间', value: 'time' },
  { label: '操作人', value: 'operator' },
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
 *
 * R22（2026-11-19 裁定）：本组件持有报表**展示项勾选**状态——勾选框 UI 在子 Tabs 行、
 * 过滤发生在报表子路由层，故经 `<Outlet context>` 合并下发（`DetailChildContext`）。
 * 裁定 Q8：详情页会话内记忆（切子 Tab 再切回不丢），换患者时重置为全勾选
 * （同路由不同 `:id` 不重挂载，须按 `id` 手动重置），不做持久化。
 */
export default function PatientDetailTabs({
  outletContext,
}: {
  outletContext: DetailOutletContext;
}) {
  const { pathname } = useLocation();
  const { id } = useParams<{ id: string }>();
  const navigateTab = useDetailTabNavigate();
  const { main, glucose } = resolveDetailTab(pathname);
  const { token } = theme.useToken();
  const [reportDisplay, setReportDisplay] = useState<GlucoseReportDisplay>(
    DEFAULT_GLUCOSE_REPORT_DISPLAY,
  );

  // 裁定 Q8：换患者时重置勾选（组件不随 :id 重挂载）
  useEffect(() => {
    setReportDisplay(DEFAULT_GLUCOSE_REPORT_DISPLAY);
  }, [id]);

  /**
   * 规则 3：常规血糖与强化血糖**至少保留一项**——取消其中一项时若另一项已未勾选，
   * 阻止本次取消并提示（裁定 Q7：antd 全局 message.warning），勾选框保持原状。
   */
  const toggleDisplay = (key: keyof GlucoseReportDisplay, checked: boolean) => {
    if (!checked && (key === 'normal' || key === 'intensive')) {
      const other = key === 'normal' ? 'intensive' : 'normal';
      if (!reportDisplay[other]) {
        void message.warning('常规血糖与强化血糖至少需勾选一项');
        return;
      }
    }
    setReportDisplay((prev) => ({ ...prev, [key]: checked }));
  };

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
        <div
          style={{
            marginTop: layoutSize.cardGap,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: token.margin,
          }}
        >
          <Tabs
            items={GLUCOSE_SUB_TABS}
            value={glucose}
            onChange={(key) => navigateTab(GLUCOSE_TAB_PATH[key as DetailGlucoseTab])}
            variant="background"
          />
          {/* R22 规则 1/2：展示项勾选紧跟子 Tabs、同一水平线，仅「血糖报告」子 Tab 渲染 */}
          {glucose === 'report' ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: token.margin,
                // 与子 Tabs 自带的 16px 下边距对称，保证同行 flex 居中对齐不被单边 margin 破坏
                marginBottom: 'var(--gc-space-md)',
              }}
            >
              {REPORT_DISPLAY_OPTIONS.map((option) => (
                <Checkbox
                  key={option.value}
                  checked={reportDisplay[option.value]}
                  onChange={(event) => toggleDisplay(option.value, event.target.checked)}
                >
                  {option.label}
                </Checkbox>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          // 有子 Tabs 时内容紧随其下（间距由子 Tabs 自带 8px 下边距提供）；无子 Tabs 时与主 Tab 拉开 cardGap
          marginTop: main === 'glucose' ? 0 : layoutSize.cardGap,
        }}
      >
        <Outlet context={{ ...outletContext, reportDisplay }} />
      </div>
    </div>
  );
}
