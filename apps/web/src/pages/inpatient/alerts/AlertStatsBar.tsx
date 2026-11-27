import type { GlucoseAlertStats } from '@gc/shared';
import { GlucoseStatsBar } from '@/components/glucose/GlucoseStatsBar';
import { buildAlertStatsItems, type AlertTab } from './alert-stats';

interface AlertStatsBarProps {
  tab: AlertTab;
  /** 首次查询未完成/查询失败时为 null：整条不渲染，避免展示「总计：0人」假数据 */
  stats: GlucoseAlertStats | null;
}

/**
 * 预警统计栏（P4-7 规格 §6）：复用 R20 GlucoseStatsBar 渲染层
 * （20px 间距 / '|' 分隔 / gc-num 等宽数字 / 全角冒号），文案口径在纯函数
 * `buildAlertStatsItems`——改口径不动渲染、改渲染不动口径（同 buildReportStatsItems 两层测试思路）。
 */
export default function AlertStatsBar({ tab, stats }: AlertStatsBarProps) {
  if (!stats) {
    return null;
  }
  return <GlucoseStatsBar items={buildAlertStatsItems(tab, stats)} />;
}
