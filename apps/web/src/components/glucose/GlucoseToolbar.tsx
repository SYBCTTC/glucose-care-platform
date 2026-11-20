import type { ReactNode } from 'react';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Button, theme } from 'antd';
import { GlucoseStatsBar } from './GlucoseStatsBar';
import type { GlucoseStatsItem } from './GlucoseStatsBar';

/**
 * 血糖数据三页共用的**工具栏行**：统计栏（左）+ 查询表单（中）+ 全屏按钮（右）。
 *
 * 为什么连布局一起封：这一行的 `space-between` + `flexWrap` + 全屏按钮 `marginLeft:auto`
 * 是 R20「布局预留」与 R24 裁定 Q18a 的结果——统计栏未加载时按钮仍要靠右、窄屏允许换行。
 * 三页各写一遍 flex 的话，这些细节迟早漂移（最常见的是漏掉 `flexShrink:0`，
 * 导致内容区撑高时工具栏被压扁）。
 *
 * 内容区（表格 / 图表 / 列表）**不在本组件内**：三页的主体差异太大（分页语义、
 * 滚动容器、ECharts 实例各不相同），强行统一只会把公共组件撑成万能组件。
 * 调用方自行渲染主体，并用 `useFullscreen().overlayStyle` 合并根节点样式。
 */

/**
 * 全屏切换按钮（R23）。图标 + 文字双通道（ui-design-tokens 规则 5 的可达性口径），
 * 图标用 `@ant-design/icons`（规则 10）；打印时隐藏（交互控件对纸质输出无意义）。
 * 导出仅为单测。
 */
export function FullscreenToggle({
  fullscreen,
  onToggle,
}: {
  fullscreen: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      className="gc-no-print"
      type="text"
      size="small"
      icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      onClick={() => onToggle(!fullscreen)}
      // marginLeft auto：统计栏未加载（无 stats）时按钮仍靠右，避免布局跳动
      style={{ marginLeft: 'auto', flexShrink: 0 }}
    >
      {fullscreen ? '退出全屏' : '全屏'}
    </Button>
  );
}

export interface GlucoseToolbarProps {
  /**
   * 统计项；不传或空数组 = 不渲染统计区（数据未加载 / 该页无统计口径）。
   * 此时全屏按钮仍靠右（`marginLeft:auto`），布局不跳动。
   */
  stats?: GlucoseStatsItem[];
  /**
   * 查询表单插槽。用 ReactNode 而非表单 props：三页的筛选条件不同
   * （报告=住院/科室/起止时间，记录还要时段/结果类型，趋势图还要粒度），
   * 传节点让各页自由组合 `<GlucoseQueryForm extra={...}/>` 或完全自定义。
   */
  form?: ReactNode;
  fullscreen: boolean;
  onToggleFullscreen: (next: boolean) => void;
}

export function GlucoseToolbar({
  stats,
  form,
  fullscreen,
  onToggleFullscreen,
}: GlucoseToolbarProps) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: token.margin,
        // 窄屏接受换行（R24 裁定 Q18a）；flexShrink:0 防止内容区撑高时工具栏被压扁
        flexWrap: 'wrap',
        flexShrink: 0,
      }}
    >
      {stats && stats.length > 0 ? <GlucoseStatsBar items={stats} /> : null}
      {form}
      <FullscreenToggle fullscreen={fullscreen} onToggle={onToggleFullscreen} />
    </div>
  );
}
