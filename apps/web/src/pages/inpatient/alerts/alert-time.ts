import { DATE_TIME_FORMAT } from '@gc/shared';
import dayjs, { type Dayjs } from 'dayjs';

/**
 * 预警筛选时间预设（P4-7 规格 §4 规则 3，口径经需求人裁定）：
 * - 本月：当月 1 日 00:00:00 ~ 当前时刻；
 * - 近一月：往前 **30 天**当日零点 ~ 当前时刻（需求原文明确固定天数）；
 * - 近三月/近半年/近一年：往前 3/6/12 个**自然月**同一日零点 ~ 当前时刻（裁定 R1-Q3；
 *   dayjs 的月减法在目标日不存在时自动收敛到月末，如 05-31 回推 3 月 → 02-28/29）；
 * - 自选区间：开始日 00:00:00 ~ 结束日 **23:59:59**（裁定 R1-Q4，含结束日全天）。
 *
 * ⚠️ 混合口径是需求原文＋裁定的结果，非笔误：近一月=固定 30 天，近三月起=日历回推。
 */
export const TIME_PRESETS = [
  'thisMonth',
  'last1m',
  'last3m',
  'last6m',
  'last1y',
  'custom',
] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

/** 下拉文案（需求原文：本月/近一月/近三月/近半年/近一年/自选时间区间） */
export const TIME_PRESET_LABELS: Record<TimePreset, string> = {
  thisMonth: '本月',
  last1m: '近一月',
  last3m: '近三月',
  last6m: '近半年',
  last1y: '近一年',
  custom: '自选时间区间',
};

export interface AlertTimeRange {
  /** 'YYYY-MM-DD HH:mm:ss' 本地秒级，闭区间起 */
  startTime: string;
  /** 闭区间止 */
  endTime: string;
}

/** 各预设对应的自然月回推数（近一月=30 天为固定天数，不在此表；本月不回推） */
const PRESET_MONTHS: Partial<Record<TimePreset, number>> = {
  last3m: 3,
  last6m: 6,
  last1y: 12,
};

/**
 * 预设 + 自选区间 → 查询闭区间（纯函数，`now` 可注入便于单测）。
 * 自选但未选区间时回退「本月」——防御性兜底，正常由 UI 保证查询前已选。
 */
export function resolveAlertTimeRange(
  preset: TimePreset,
  customRange: [Dayjs, Dayjs] | null,
  now: Dayjs = dayjs(),
): AlertTimeRange {
  const endTime = now.format(DATE_TIME_FORMAT);
  if (preset === 'custom') {
    if (!customRange) {
      return { startTime: now.startOf('month').format(DATE_TIME_FORMAT), endTime };
    }
    return {
      startTime: customRange[0].startOf('day').format(DATE_TIME_FORMAT),
      // endOf('day') = 23:59:59，含结束日全天（裁定 R1-Q4）
      endTime: customRange[1].endOf('day').format(DATE_TIME_FORMAT),
    };
  }
  if (preset === 'last1m') {
    return {
      startTime: now.subtract(30, 'day').startOf('day').format(DATE_TIME_FORMAT),
      endTime,
    };
  }
  const months = PRESET_MONTHS[preset];
  if (months !== undefined) {
    return {
      startTime: now.subtract(months, 'month').startOf('day').format(DATE_TIME_FORMAT),
      endTime,
    };
  }
  // thisMonth
  return { startTime: now.startOf('month').format(DATE_TIME_FORMAT), endTime };
}
