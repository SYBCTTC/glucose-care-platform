/**
 * 时段划分与预警范围（公共数据 D-TIMESLOT / D-ALERT）。
 * 后续患者血糖展示按"时段"作为表头分组。
 * 来源：静态字典，随 @gc/shared 发布。
 */
export const TIME_SLOT_TYPE = {
  /** 普通时段 */
  NORMAL: 'NORMAL',
  /** 强化时段（更密集监测） */
  INTENSIVE: 'INTENSIVE',
} as const;
export type TimeSlotType = (typeof TIME_SLOT_TYPE)[keyof typeof TIME_SLOT_TYPE];

export interface TimeSlot {
  /** 唯一码，如 BREAKFAST_PRE / INTENSIVE_AM */
  code: string;
  /** 中文名称，作表头 */
  name: string;
  /** 普通 / 强化 */
  type: TimeSlotType;
  /**
   * 起止时间 HH:mm（预留字段）。
   * 业务不固化具体时间，统一留空，仅保留分组语义；
   * 具体时段归属由录入的 measuredAt 判断。
   */
  start?: string;
  end?: string;
}

/**
 * 血糖展示表头用的时段划分。
 * 普通时段：早/午/晚餐前、早/午/晚餐后、睡前、空腹。
 * 强化时段：上/下/夜三段。
 * 起止时间不固化（start/end 留空），仅用于分组。
 */
export const TIME_SLOTS: TimeSlot[] = [
  { code: 'FASTING', name: '空腹', type: 'NORMAL' },
  { code: 'BREAKFAST_PRE', name: '早餐前', type: 'NORMAL' },
  { code: 'BREAKFAST_POST', name: '早餐后', type: 'NORMAL' },
  { code: 'LUNCH_PRE', name: '午餐前', type: 'NORMAL' },
  { code: 'LUNCH_POST', name: '午餐后', type: 'NORMAL' },
  { code: 'DINNER_PRE', name: '晚餐前', type: 'NORMAL' },
  { code: 'DINNER_POST', name: '晚餐后', type: 'NORMAL' },
  { code: 'BEDTIME', name: '睡前', type: 'NORMAL' },
  /** 随机时段：不符合固定时段的临时测量，排在常规时段末尾、强化时段之前 */
  { code: 'RANDOM', name: '随机', type: 'NORMAL' },
  { code: 'INTENSIVE_AM', name: '强化-上午', type: 'INTENSIVE' },
  { code: 'INTENSIVE_PM', name: '强化-下午', type: 'INTENSIVE' },
  { code: 'INTENSIVE_NIGHT', name: '强化-夜间', type: 'INTENSIVE' },
];

export function getTimeSlotLabel(code: string): string {
  return TIME_SLOTS.find((s) => s.code === code)?.name ?? code;
}

export function getTimeSlotsByType(type: TimeSlotType): TimeSlot[] {
  return TIME_SLOTS.filter((s) => s.type === type);
}

/**
 * 默认预警范围（mmol/L）。
 * 原属 SystemConfig（低血糖 < low，高血糖 > high），现阶段以常量占位；
 * 接口就绪后应改为读取 SystemConfig（key: alert.low / alert.high），禁止在业务代码硬编码。
 */
export const DEFAULT_ALERT_RANGE = {
  low: 3.9,
  high: 16.7,
} as const;
