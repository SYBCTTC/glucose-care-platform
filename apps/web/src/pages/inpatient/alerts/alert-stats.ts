import type { GlucoseAlertStats, GlucoseAlertType } from '@gc/shared';
import type { GlucoseStatsItem } from '@/components/glucose/GlucoseStatsBar';

/** 顶部 Tab（规格 §6）：all=所有预警；high/low=单边预警（与接口 type 参数同一套枚举） */
export type AlertTab = 'all' | GlucoseAlertType;

/**
 * 统计栏条目（规格 §6 统计栏格式，裁定 R2-Q1 口径）：
 * - 所有预警 Tab：`总计：X人 ⟨20px⟩ Y次 ⟨20px⟩ | ⟨20px⟩ 高血糖预警：H次 ⟨20px⟩ 低血糖预警：L次`
 * - 高/低 Tab：`总计：X人 ⟨20px⟩ Y次`
 *
 * 口径层与渲染层（GlucoseStatsBar）分离，沿 R20 `buildReportStatsItems` 先例：
 * 改口径不动渲染、改渲染不动口径。第二项无 label（只渲染「Y次」）——
 * GlucoseStatsBar 已扩展支持省略 label 的条目（省略时不渲染「label：」前缀）。
 */
export function buildAlertStatsItems(tab: AlertTab, stats: GlucoseAlertStats): GlucoseStatsItem[] {
  const head: GlucoseStatsItem[] = [
    { label: '总计', value: String(stats.patientCount), suffix: '人', numeric: true },
    { value: String(stats.totalCount), suffix: '次', numeric: true },
  ];
  if (tab !== 'all') {
    return head;
  }
  return [
    ...head,
    {
      label: '高血糖预警',
      value: String(stats.highCount),
      suffix: '次',
      numeric: true,
      divider: true,
    },
    { label: '低血糖预警', value: String(stats.lowCount), suffix: '次', numeric: true },
  ];
}
