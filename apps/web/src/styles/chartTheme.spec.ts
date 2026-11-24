/**
 * P3-7 趋势图 buildTrendOption **纯函数**测试（web 测试跑在 node 环境，无 jsdom）。
 * 外层 GlucoseTrendTab 依赖 Outlet context / 网络 / ECharts DOM 渲染，靠 typecheck + 手工 e2e 验证
 * （同 GlucoseRecordTab.spec.tsx 口径：只测抽出来的纯函数）。
 *
 * 验收主体（docs/specs/glucose-trend.md）：
 *  - 图表形态：原始测量点时间轴散点，三系列（偏低/正常/偏高）按 DY-RESULT 字典色/标签；
 *  - 阈值线 + 目标范围带挂在**不进图例**的专用系列，切换点系列时恒可见；
 *  - tooltip 同时展示测量时间 + 血糖值 + 录入人（glucose-domain 图表节硬要求）；
 *  - 字典缺失回退 glucoseColor 令牌与 code 原文（禁止硬编码色值/文案）。
 */
import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import type { DictItemOption, GlucoseTrendPoint } from '@gc/shared';
import { buildTrendOption } from './chartTheme';
import { glucoseColor } from './tokens';

/** 与 seed 同形的 DY-RESULT 数值型片段（颜色刻意取与令牌不同的值，以验证「取字典色」而非兜底色） */
const RESULT_TYPES: DictItemOption[] = [
  { code: '0', label: '偏低', color: '#1890FF', checkable: false, counted: true, sortOrder: 0 },
  { code: '1', label: '正常', color: '#52C41A', checkable: false, counted: true, sortOrder: 1 },
  { code: '2', label: '偏高', color: '#F5222D', checkable: false, counted: true, sortOrder: 2 },
];

const THRESHOLDS = { low: 3.9, high: 16.7 };

function point(overrides: Partial<GlucoseTrendPoint> = {}): GlucoseTrendPoint {
  return {
    id: 'g-1',
    measuredAt: '2026-11-19 09:00:00',
    valueMmolL: 6.8,
    resultType: '1',
    operatorName: '李护士',
    ...overrides,
  };
}

/** series 的宽松断言形状（EChartsOption['series'] 是庞大联合类型，不便直接索引） */
type SeriesShape = {
  name: string;
  type: string;
  itemStyle?: { color?: string };
  data: Array<{
    value: [number, number];
    recordId: string;
    measuredAt: string;
    operatorName: string | null;
  }>;
  markLine?: { data: Array<{ yAxis?: number }> };
  markArea?: unknown;
};

function build(overrides: Partial<Parameters<typeof buildTrendOption>[0]> = {}) {
  return buildTrendOption({
    points: [point()],
    thresholds: THRESHOLDS,
    mode: 'light',
    resultTypes: RESULT_TYPES,
    ...overrides,
  });
}

const seriesOf = (option: ReturnType<typeof buildTrendOption>): SeriesShape[] =>
  option.series as unknown as SeriesShape[];

describe('buildTrendOption — 原始测量点时间轴散点（P3-7）', () => {
  it('三个点系列（字典标签/色）+ 一个不进图例的阈值系列；图例只列点系列', () => {
    const option = build();
    const series = seriesOf(option);

    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({
      name: '偏低',
      type: 'scatter',
      itemStyle: { color: '#1890FF' },
    });
    expect(series[1]).toMatchObject({
      name: '正常',
      type: 'scatter',
      itemStyle: { color: '#52C41A' },
    });
    expect(series[2]).toMatchObject({
      name: '偏高',
      type: 'scatter',
      itemStyle: { color: '#F5222D' },
    });
    expect(series[3]).toMatchObject({ name: '__thresholds__', type: 'line' });

    const legend = option.legend as unknown as { data?: string[] };
    expect(legend.data).toEqual(['偏低', '正常', '偏高']);
  });

  it('点按 resultType 分组进对应系列；value=[毫秒时间戳, 血糖值] 且带 recordId/录入人', () => {
    const option = build({
      points: [
        point({ id: 'g-low', resultType: '0', valueMmolL: 3.2, measuredAt: '2026-11-19 08:00:00' }),
        point({
          id: 'g-normal',
          resultType: '1',
          valueMmolL: 6.8,
          measuredAt: '2026-11-19 09:00:00',
        }),
        point({
          id: 'g-high',
          resultType: '2',
          valueMmolL: 18.5,
          measuredAt: '2026-11-19 10:00:00',
        }),
      ],
    });
    const series = seriesOf(option);

    expect(series[0].data).toEqual([
      {
        value: [dayjs('2026-11-19 08:00:00').valueOf(), 3.2],
        recordId: 'g-low',
        measuredAt: '2026-11-19 08:00:00',
        operatorName: '李护士',
      },
    ]);
    expect(series[1].data.map((d) => d.recordId)).toEqual(['g-normal']);
    expect(series[2].data.map((d) => d.recordId)).toEqual(['g-high']);
  });

  it('阈值系列带低/高阈值线与目标范围带', () => {
    const thresholdSeries = seriesOf(build())[3];

    expect(thresholdSeries.markLine?.data.map((d) => d.yAxis)).toEqual([3.9, 16.7]);
    expect(thresholdSeries.markArea).toBeDefined();
  });

  it('tooltip formatter 同时展示测量时间 + 血糖值 + 类型 + 录入人（glucose-domain 图表节）', () => {
    const tooltip = build().tooltip as unknown as { formatter?: (params: unknown) => string };
    const html = tooltip.formatter?.({
      value: [dayjs('2026-11-19 09:00:00').valueOf(), 6.8],
      seriesName: '正常',
      data: { measuredAt: '2026-11-19 09:00:00', operatorName: '李护士' },
    });

    expect(html).toContain('2026-11-19 09:00:00');
    expect(html).toContain('6.8');
    expect(html).toContain('正常');
    expect(html).toContain('李护士');
  });

  it('录入人为 null → tooltip 记录者显示 -', () => {
    const tooltip = build().tooltip as unknown as { formatter?: (params: unknown) => string };
    const html = tooltip.formatter?.({
      value: [0, 6.8],
      seriesName: '正常',
      data: { measuredAt: '2026-11-19 09:00:00', operatorName: null },
    });

    expect(html).toContain('记录者：-');
  });

  it('字典缺失 → 系列名回退 code 原文、颜色回退 glucoseColor 令牌（禁止硬编码）', () => {
    const series = seriesOf(build({ resultTypes: [] }));

    expect(series[0]).toMatchObject({ name: '0', itemStyle: { color: glucoseColor.low } });
    expect(series[1]).toMatchObject({ name: '1', itemStyle: { color: glucoseColor.normal } });
    expect(series[2]).toMatchObject({ name: '2', itemStyle: { color: glucoseColor.high } });
  });

  it('空点 → 三个点系列 data 为空、阈值系列仍在（前端走 Empty 态而非报错）', () => {
    const series = seriesOf(build({ points: [] }));

    expect(series).toHaveLength(4);
    expect(series[0].data).toEqual([]);
    expect(series[1].data).toEqual([]);
    expect(series[2].data).toEqual([]);
    expect(series[3].markLine?.data).toHaveLength(2);
  });
});
