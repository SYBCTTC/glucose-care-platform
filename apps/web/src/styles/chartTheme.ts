import dayjs from 'dayjs';
import type { EChartsOption } from 'echarts';
import { GLUCOSE_VALUE_RESULT_CODES } from '@gc/shared';
import type { DictItemOption, GlucoseTrendPoint } from '@gc/shared';
import { glucoseColor } from './tokens';
import type { ThemeMode } from './tokens';

/**
 * ECharts 主题（docs/UI-DESIGN-TOKENS.md 第 12 节）。
 * 图表配色、阈值线、目标范围带统一在此定义，页面不得自行拼色。
 */

interface TrendParams {
  /** 原始测量点（共享契约 GlucoseTrendPoint）：数值型 0/1/2，按 measuredAt 升序 */
  points: GlucoseTrendPoint[];
  /** 告警阈值（服务端 SystemConfig 下发），画低/高阈值线与目标范围带 */
  thresholds: { low: number; high: number };
  mode: ThemeMode;
  /** DY-RESULT 字典：结果类型 0/1/2 的颜色/标签来源；缺失时回退 glucoseColor 令牌与 code 原文 */
  resultTypes: DictItemOption[];
}

/** 字典缺失时数值型结果（偏低/正常/偏高）的兜底色：映射到设计令牌，非硬编码色值 */
const VALUE_TYPE_FALLBACK_COLOR: Record<string, string> = {
  '0': glucoseColor.low,
  '1': glucoseColor.normal,
  '2': glucoseColor.high,
};

const axisTextColor = (mode: ThemeMode) =>
  mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';

const splitLineColor = (mode: ThemeMode) => (mode === 'dark' ? '#303030' : '#f0f0f0');

const tooltipBg = (mode: ThemeMode) =>
  mode === 'dark' ? 'rgba(20,20,20,0.92)' : 'rgba(0,0,0,0.85)';

/**
 * 血糖趋势图（P3-7：原始测量点散点，裁定=图表形态为原始测量点，不做按日聚合）。
 *
 * 三个数值型结果（偏低 '0' / 正常 '1' / 偏高 '2'）各一个 scatter 系列，颜色与图例文案取
 * DY-RESULT 字典（缺失回退 glucoseColor 令牌与 code 原文，禁止硬编码）；阈值线 + 目标范围带
 * 挂在**不进图例**的专用空数据 line 系列上，切换点系列显隐时恒可见。
 * tooltip 按 glucose-domain 图表节同时展示测量时间 + 血糖值 + 录入人；数据点带 recordId 供点击进复核弹窗。
 */
export function buildTrendOption({
  points,
  thresholds,
  mode,
  resultTypes,
}: TrendParams): EChartsOption {
  // measuredAt 是本地时刻串（YYYY-MM-DD HH:mm:ss），转毫秒时间戳供 time 轴（dayjs 按本地时区解析）
  const toTs = (measuredAt: string): number => dayjs(measuredAt).valueOf();
  const labelOf = (code: string): string =>
    resultTypes.find((option) => option.code === code)?.label ?? code;
  const colorOf = (code: string): string =>
    resultTypes.find((option) => option.code === code)?.color ??
    VALUE_TYPE_FALLBACK_COLOR[code] ??
    glucoseColor.normal;

  return {
    textStyle: { fontFamily: 'inherit' },
    tooltip: {
      trigger: 'item',
      backgroundColor: tooltipBg(mode),
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
      // glucose-domain 图表节：tooltip 必须同时展示测量时间与录入人
      formatter: (params: unknown): string => {
        const item = params as {
          value?: [number, number];
          seriesName?: string;
          data?: { measuredAt?: string; operatorName?: string | null };
        };
        const glucose = Array.isArray(item.value) ? Number(item.value[1]).toFixed(1) : '-';
        const time = item.data?.measuredAt ?? '-';
        const operator = item.data?.operatorName ?? '-';
        return `${time}<br/>血糖：${glucose} mmol/L（${item.seriesName ?? ''}）<br/>记录者：${operator}`;
      },
    },
    legend: {
      top: 0,
      right: 0,
      // 只列三个点系列；阈值专用系列不进图例、不可被切掉
      data: GLUCOSE_VALUE_RESULT_CODES.map(labelOf),
      textStyle: { color: axisTextColor(mode), fontSize: 12 },
    },
    grid: { left: 56, right: 24, top: 40, bottom: 48 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: splitLineColor(mode) } },
      axisTick: { show: false },
      axisLabel: { color: axisTextColor(mode), fontSize: 12, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: 'mmol/L',
      // 不强制从 0 起：血糖值域窄，scale 让纵轴按数据展开，波动更易读
      scale: true,
      nameTextStyle: { color: axisTextColor(mode), fontSize: 12, padding: [0, 0, 0, -28] },
      axisLabel: { color: axisTextColor(mode), fontSize: 12 },
      splitLine: { lineStyle: { color: splitLineColor(mode), type: 'dashed' } },
    },
    series: [
      ...GLUCOSE_VALUE_RESULT_CODES.map((code) => ({
        name: labelOf(code),
        type: 'scatter' as const,
        symbolSize: 8,
        itemStyle: { color: colorOf(code) },
        // 大数据量（CGM 未来）：渐进渲染；阈值以下走普通路径，tooltip/点击不受影响
        large: true,
        largeThreshold: 2000,
        data: points
          .filter((point) => point.resultType === code)
          .map((point) => ({
            value: [toTs(point.measuredAt), point.valueMmolL],
            // 附加字段供 tooltip（时间/录入人）与点击（recordId → 复核弹窗）经 params.data 读取
            recordId: point.id,
            measuredAt: point.measuredAt,
            operatorName: point.operatorName,
          })),
      })),
      // 阈值线 + 目标范围带：挂在不进图例的专用空数据 line 系列，切换点系列显隐时恒可见
      {
        name: '__thresholds__',
        type: 'line' as const,
        data: [],
        silent: true,
        markLine: {
          symbol: 'none',
          label: { fontSize: 12 },
          data: [
            {
              yAxis: thresholds.low,
              name: '低值阈值',
              lineStyle: { color: glucoseColor.low, type: 'dashed', width: 1 },
              label: { formatter: `低 ${thresholds.low}`, color: glucoseColor.low },
            },
            {
              yAxis: thresholds.high,
              name: '高值阈值',
              lineStyle: { color: glucoseColor.high, type: 'dashed', width: 1 },
              label: { formatter: `高 ${thresholds.high}`, color: glucoseColor.high },
            },
          ],
        },
        markArea: {
          silent: true,
          // glucoseColor.tir（#52c41a = rgb(82,196,26)）8% 不透明度，作目标范围带
          itemStyle: { color: 'rgba(82, 196, 26, 0.08)' },
          data: [[{ yAxis: thresholds.low, name: '目标范围' }, { yAxis: thresholds.high }]],
        },
      },
    ],
  };
}
