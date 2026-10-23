import type { EChartsOption } from 'echarts';
import { brandColor, chartPalette, glucoseColor } from './tokens';
import type { ThemeMode } from './tokens';

/**
 * ECharts 主题（docs/UI-DESIGN-TOKENS.md 第 12 节）。
 * 图表配色、阈值线、目标范围带统一在此定义，页面不得自行拼色。
 */

interface TrendPoint {
  date: string;
  avg: number;
  min: number;
  max: number;
}

interface TrendParams {
  points: TrendPoint[];
  thresholds: { low: number; high: number };
  mode: ThemeMode;
}

const axisTextColor = (mode: ThemeMode) => (mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)');

const splitLineColor = (mode: ThemeMode) => (mode === 'dark' ? '#303030' : '#f0f0f0');

const tooltipBg = (mode: ThemeMode) => (mode === 'dark' ? 'rgba(20,20,20,0.92)' : 'rgba(0,0,0,0.85)');

/** 血糖趋势图（日均值 + 低高阈值线 + 目标范围带） */
export function buildTrendOption({ points, thresholds, mode }: TrendParams): EChartsOption {
  return {
    color: chartPalette,
    textStyle: { fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg(mode),
      borderWidth: 0,
      textStyle: { color: '#fff', fontSize: 12 },
      valueFormatter: (value) => `${Number(value).toFixed(1)} mmol/L`,
    },
    legend: { top: 0, right: 0, textStyle: { color: axisTextColor(mode), fontSize: 12 } },
    grid: { left: 48, right: 24, top: 32, bottom: 32 },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.date),
      axisLine: { lineStyle: { color: splitLineColor(mode) } },
      axisTick: { show: false },
      axisLabel: { color: axisTextColor(mode), fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      name: 'mmol/L',
      nameTextStyle: { color: axisTextColor(mode), fontSize: 12, padding: [0, 0, 0, -28] },
      axisLabel: { color: axisTextColor(mode), fontSize: 12 },
      splitLine: { lineStyle: { color: splitLineColor(mode), type: 'dashed' } },
    },
    series: [
      {
        name: '日均值',
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: 4,
        lineStyle: { width: 2, color: brandColor.primary },
        itemStyle: { color: brandColor.primary },
        areaStyle: {
          // 主色 15% → 0% 渐变
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(106, 211, 216, 0.15)' },
              { offset: 1, color: 'rgba(106, 211, 216, 0)' },
            ],
          },
        },
        data: points.map((point) => point.avg),
        // CGM 阶段数据量大：抽稀 + 大数据模式
        sampling: 'lttb',
        markLine: {
          symbol: 'none',
          label: { fontSize: 12, color: axisTextColor(mode) },
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
          itemStyle: { color: 'rgba(82, 196, 26, 0.08)' },
          data: [[{ yAxis: thresholds.low, name: '目标范围' }, { yAxis: thresholds.high }]],
        },
      },
      {
        name: '日内最低',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, type: 'dotted', color: chartPalette[1] },
        itemStyle: { color: chartPalette[1] },
        data: points.map((point) => point.min),
      },
      {
        name: '日内最高',
        type: 'line',
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1, type: 'dotted', color: chartPalette[3] },
        itemStyle: { color: chartPalette[3] },
        data: points.map((point) => point.max),
      },
    ],
  };
}
