import type { GlucoseAlertStats } from '@gc/shared';
import { describe, expect, it } from 'vitest';
import { buildAlertStatsItems } from './alert-stats';

/**
 * 预警统计栏的**口径层**测试（P4-7 规格 §6，裁定 R2-Q1）。
 * 渲染层（间距/竖线/gc-num）在 `GlucoseStatsBar.spec.tsx`，两层分开测：
 * 换口径不动渲染、换渲染不动口径（沿 R20 buildReportStatsItems 先例）。
 */

const STATS: GlucoseAlertStats = {
  patientCount: 17,
  totalCount: 42,
  highCount: 30,
  lowCount: 12,
};

describe('buildAlertStatsItems — 所有预警 Tab（4 项）', () => {
  const items = buildAlertStatsItems('all', STATS);

  it('总计：X人 ⟨20px⟩ Y次 ⟨20px⟩ | ⟨20px⟩ 高血糖预警：H次 ⟨20px⟩ 低血糖预警：L次', () => {
    expect(items).toEqual([
      { label: '总计', value: '17', suffix: '人', numeric: true },
      { value: '42', suffix: '次', numeric: true },
      { label: '高血糖预警', value: '30', suffix: '次', numeric: true, divider: true },
      { label: '低血糖预警', value: '12', suffix: '次', numeric: true },
    ]);
  });

  it('第二项无 label（纯「Y次」段，GlucoseStatsBar 省略 label 不渲染前缀）', () => {
    expect(items[1].label).toBeUndefined();
  });

  it('竖线分隔符挂在高血糖预警项前（总计组与高低组视觉断开）', () => {
    expect(items.filter((item) => item.divider)).toHaveLength(1);
    expect(items[2].divider).toBe(true);
  });
});

describe('buildAlertStatsItems — 高/低血糖预警 Tab（2 项）', () => {
  it.each(['high', 'low'] as const)('%s Tab：只保留 总计：X人 Y次，不展示高低拆分', (tab) => {
    expect(buildAlertStatsItems(tab, STATS)).toEqual([
      { label: '总计', value: '17', suffix: '人', numeric: true },
      { value: '42', suffix: '次', numeric: true },
    ]);
  });

  it('统计值随接口下发原样展示（服务端已按 Tab 归零另一侧，口径层不做二次计算）', () => {
    const lowOnly: GlucoseAlertStats = {
      patientCount: 3,
      totalCount: 5,
      highCount: 0,
      lowCount: 5,
    };

    const items = buildAlertStatsItems('low', lowOnly);

    expect(items[0].value).toBe('3');
    expect(items[1].value).toBe('5');
  });
});
