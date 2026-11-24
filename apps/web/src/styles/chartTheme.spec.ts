/**
 * P3-7 趋势图 buildTrendOption **纯函数**测试（web 测试跑在 node 环境，无 jsdom）。
 * 外层 GlucoseTrendTab 依赖 Outlet context / 网络 / ECharts DOM 渲染，靠 typecheck + 手工 e2e 验证
 * （同 GlucoseRecordTab.spec.tsx 口径：只测抽出来的纯函数）。
 *
 * 验收主体（docs/specs/glucose-trend.md）：
 *  - 图表形态：原始测量点时间轴图，三系列（偏低/正常/偏高）按 DY-RESULT 字典色/标签；
 *    chartType 在折线（line，默认形态）/ 散点（scatter）间切换，仅系列 type 与渲染参数不同；
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
  // 散点专属
  large?: boolean;
  largeThreshold?: number;
  // 折线专属
  showSymbol?: boolean;
  lineStyle?: { color?: string; width?: number };
  data: Array<{
    value: [number, number];
    recordId: string;
    measuredAt: string;
    operatorName: string | null;
  }>;
  markLine?: { data: Array<{ yAxis?: number }> };
  markArea?: unknown;
};

/** 默认按散点构建（保持既有用例）；折线模式用例显式传 chartType: 'line' */
function build(overrides: Partial<Parameters<typeof buildTrendOption>[0]> = {}) {
  return buildTrendOption({
    points: [point()],
    thresholds: THRESHOLDS,
    mode: 'light',
    resultTypes: RESULT_TYPES,
    chartType: 'scatter',
    ...overrides,
  });
}

const seriesOf = (option: ReturnType<typeof buildTrendOption>): SeriesShape[] =>
  option.series as unknown as SeriesShape[];

/** xAxis 的宽松断言形状（EChartsOption['xAxis'] 是联合类型，不便直接索引） */
type XAxisShape = {
  type: string;
  min?: number;
  max?: number;
  minInterval?: number;
  axisLabel?: { formatter?: string; hideOverlap?: boolean };
};

const xAxisOf = (option: ReturnType<typeof buildTrendOption>): XAxisShape =>
  option.xAxis as unknown as XAxisShape;

describe('buildTrendOption — 散点模式（chartType: scatter，P3-7）', () => {
  it('三个点系列（字典标签/色）+ 一个不进图例的阈值系列；图例只列点系列', () => {
    const option = build();
    const series = seriesOf(option);

    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({
      name: '偏低',
      type: 'scatter',
      itemStyle: { color: '#1890FF' },
      large: true,
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

describe('buildTrendOption — 折线模式（chartType: line，默认形态，P3-7）', () => {
  it('三个点系列 type 变 line，颜色/图例/阈值系列与散点一致（仅渲染形态不同）', () => {
    const option = build({ chartType: 'line' });
    const series = seriesOf(option);

    expect(series).toHaveLength(4);
    expect(series[0]).toMatchObject({
      name: '偏低',
      type: 'line',
      itemStyle: { color: '#1890FF' },
    });
    expect(series[1]).toMatchObject({
      name: '正常',
      type: 'line',
      itemStyle: { color: '#52C41A' },
    });
    expect(series[2]).toMatchObject({
      name: '偏高',
      type: 'line',
      itemStyle: { color: '#F5222D' },
    });
    expect(series[3]).toMatchObject({ name: '__thresholds__', type: 'line' });

    const legend = option.legend as unknown as { data?: string[] };
    expect(legend.data).toEqual(['偏低', '正常', '偏高']);
  });

  it('折线系列保留可点击符号（showSymbol）、线色=字典色、线宽 1.5；不带散点渐进渲染字段', () => {
    const series = seriesOf(build({ chartType: 'line' }));

    expect(series[0].showSymbol).toBe(true);
    expect(series[0].lineStyle).toEqual({ width: 1.5, color: '#1890FF' });
    expect(series[0].large).toBeUndefined();
  });

  it('数据点仍带 recordId/录入人（点击复核、tooltip 不受形态影响）', () => {
    const series = seriesOf(
      build({ chartType: 'line', points: [point({ id: 'g-line', operatorName: '王医生' })] }),
    );

    // resultType '1' → 第二个系列
    expect(series[1].data[0]).toMatchObject({ recordId: 'g-line', operatorName: '王医生' });
  });

  it('字典缺失 → 线色同样回退 glucoseColor 令牌（禁止硬编码）', () => {
    const series = seriesOf(build({ chartType: 'line', resultTypes: [] }));

    expect(series[0]).toMatchObject({
      name: '0',
      type: 'line',
      itemStyle: { color: glucoseColor.low },
    });
    expect(series[0].lineStyle?.color).toBe(glucoseColor.low);
  });
});

describe('buildTrendOption — X 轴日期级范围/刻度（P3-7 增补）', () => {
  it('多日数据 → min/max 取数据日界（最小日 00:00 / 最大日 endOf 天），刻度标签 MM-DD、刻度下限 1 天', () => {
    const xAxis = xAxisOf(
      build({
        points: [
          point({ measuredAt: '2026-11-19 08:00:00' }),
          point({ id: 'g-2', measuredAt: '2026-11-22 20:30:00' }),
        ],
      }),
    );

    expect(xAxis.type).toBe('time');
    expect(xAxis.min).toBe(dayjs('2026-11-19').startOf('day').valueOf());
    expect(xAxis.max).toBe(dayjs('2026-11-22').endOf('day').valueOf());
    expect(xAxis.minInterval).toBe(86400000);
    expect(xAxis.axisLabel?.formatter).toBe('{MM}-{dd}');
    expect(xAxis.axisLabel?.hideOverlap).toBe(true);
  });

  it('单日数据（最小日 = 最大日）→ 向两侧各扩 1 天（跨 3 天居中该日，避免刻度重复同一 MM-DD）', () => {
    const xAxis = xAxisOf(
      build({
        points: [
          point({ measuredAt: '2026-11-19 08:00:00' }),
          point({ id: 'g-2', measuredAt: '2026-11-19 20:00:00' }),
        ],
      }),
    );

    expect(xAxis.min).toBe(dayjs('2026-11-18').startOf('day').valueOf());
    expect(xAxis.max).toBe(dayjs('2026-11-20').endOf('day').valueOf());
  });

  it('数据点保留时分秒：value 横坐标仍是精确毫秒时间戳（未截断到日）', () => {
    const series = seriesOf(build({ points: [point({ measuredAt: '2026-11-19 08:30:15' })] }));

    // resultType '1' → 第二个系列；横坐标 = 完整时间戳（含时分秒），仅轴标签显示 MM-DD
    expect(series[1].data[0].value[0]).toBe(dayjs('2026-11-19 08:30:15').valueOf());
  });

  it('空点 → X 轴 min/max 为 undefined（交轴自动，不设日界）', () => {
    const xAxis = xAxisOf(build({ points: [] }));

    expect(xAxis.min).toBeUndefined();
    expect(xAxis.max).toBeUndefined();
  });
});
