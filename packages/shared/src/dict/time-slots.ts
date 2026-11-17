/**
 * 时段（D-TIMESLOT）。
 *
 * 时段已从**静态字典**改为**动态数据**：数据表 `TimeSlot`，接口 `GET /time-slots`，
 * 前端登录后随公共数据一次性加载进 `useCommonDataStore().timeSlots`。
 * 本文件保留三类内容：
 *  1. `TIME_SLOT_CATEGORY`：type 取值语义（0 强化 / 1 普通 / 4 特殊）；
 *  2. `TIME_SLOTS`：**仅 seed 灌库数据源**（`apps/server/prisma/seed.ts`），运行时一律以库数据为准；
 *  3. `pickTimeSlotByTime`：按检测时间求所属普通时段（录入默认值，后续报表归组复用），入参必须是接口下发的时段。
 *
 * ⚠️ 本文件**不再提供任何静态兜底**（原 `getFallbackTimeSlots` / `getTimeSlotLabel` 已移除）：
 *  - 时段可用性由服务端查 `TimeSlot` 表运行时校验，静态清单兜底会让"库里已停用/已改名"的时段
 *    在前端看起来仍可选，提交后才被拒，反而更难排查；
 *  - 用静态名称兜底历史记录的 code，会掩盖库数据缺失。取不到名称时直接展示 code，问题可见。
 *
 * 口径（与业务确认过）：
 *  - 只有**普通时段**要求 00:00~24:00 全覆盖、不重叠、不跨零点，区间左闭右开 `[startTime, endTime)`；
 *  - 特殊时段（随机/复测）与强化时段不要求区间，`startTime/endTime/timeScope` 均为 null；
 *  - 控糖目标 `valueDown/valueUp`（mmol/L）只落在普通时段，特殊/强化为空。
 *
 * 注意：`code` 是**契约**（`GlucoseRecord.mealContext` 的落库值），改名不改码。
 */
export const TIME_SLOT_CATEGORY = {
  /** 强化时段：更密集监测；展示时按检测时间落点归入对应普通时段（展示逻辑后续实现） */
  INTENSIVE: 0,
  /** 普通时段：血糖报表表头分组的主体，区间必须 24 小时全覆盖 */
  NORMAL: 1,
  /** 特殊时段：随机 / 复测，排在普通时段之后 */
  SPECIAL: 4,
} as const;
export type TimeSlotCategory = (typeof TIME_SLOT_CATEGORY)[keyof typeof TIME_SLOT_CATEGORY];

/** 时段接口下发项（`GET /time-slots`） */
export interface TimeSlotOption {
  /** 时段码，落库值（`GlucoseRecord.mealContext`） */
  code: string;
  /** 时段名，展示用；可在库里改，不影响历史数据 */
  name: string;
  /** 0 强化 / 1 普通 / 4 特殊 */
  type: TimeSlotCategory;
  /** 起点 HH:mm；无区间时为 null */
  startTime: string | null;
  /** 终点 HH:mm，'24:00' 表示当日终点；无区间时为 null */
  endTime: string | null;
  /** 派生字段：`startTime-endTime`，服务端拼接、不落库；无区间时为 null */
  timeScope: string | null;
  /** 控糖目标下限 mmol/L；未设置时为 null */
  valueDown: number | null;
  /** 控糖目标上限 mmol/L；未设置时为 null */
  valueUp: number | null;
  /** 同类型内展示顺序，升序 */
  sortOrder: number;
  /** 停用项也会下发（历史血糖需按 code 展示名称），下拉只渲染 enabled 项 */
  enabled: boolean;
}

/** seed 灌库用的时段形态（`timeScope` 是派生字段、`enabled` 由库默认值给出，均不在 seed 里写） */
export type TimeSlotSeed = Omit<TimeSlotOption, 'timeScope' | 'enabled'>;

/**
 * 默认时段清单：**仅供 `apps/server/prisma/seed.ts` 幂等 upsert 灌库**。
 * 普通时段覆盖 00:00~24:00 且首尾相接，特殊/强化无区间。
 *
 * 区间与控糖目标按常见口径给出（空腹/餐前 4.4~7.0，餐后 4.4~10.0，睡前 5.0~8.3），
 * 属**待业务校准的初始值**：上线前由临床确认后在库里直接调整数据即可，无需改代码。
 *
 * ⚠️ 禁止在运行时用它做校验或展示兜底：库里的时段可能已新增、改名或停用，
 * 以本清单为准会与库数据漂移。校验走服务端查 `TimeSlot` 表，展示走 `GET /time-slots`。
 */
export const TIME_SLOTS: TimeSlotSeed[] = [
  // 普通时段：00:00 → 24:00 首尾相接，左闭右开
  {
    code: 'FASTING',
    name: '空腹',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '00:00',
    endTime: '07:00',
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 10,
  },
  {
    code: 'BREAKFAST_PRE',
    name: '早餐前',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '07:00',
    endTime: '08:00',
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 20,
  },
  {
    code: 'BREAKFAST_POST',
    name: '早餐后',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '08:00',
    endTime: '11:00',
    valueDown: 4.4,
    valueUp: 10.0,
    sortOrder: 30,
  },
  {
    code: 'LUNCH_PRE',
    name: '午餐前',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '11:00',
    endTime: '12:00',
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 40,
  },
  {
    code: 'LUNCH_POST',
    name: '午餐后',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '12:00',
    endTime: '17:00',
    valueDown: 4.4,
    valueUp: 10.0,
    sortOrder: 50,
  },
  {
    code: 'DINNER_PRE',
    name: '晚餐前',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '17:00',
    endTime: '18:00',
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 60,
  },
  {
    code: 'DINNER_POST',
    name: '晚餐后',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '18:00',
    endTime: '22:00',
    valueDown: 4.4,
    valueUp: 10.0,
    sortOrder: 70,
  },
  {
    code: 'BEDTIME',
    name: '睡前',
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: '22:00',
    endTime: '24:00',
    valueDown: 5.0,
    valueUp: 8.3,
    sortOrder: 80,
  },
  // 特殊时段：无区间、无控糖目标，排在普通时段之后
  {
    code: 'RANDOM',
    name: '随机',
    type: TIME_SLOT_CATEGORY.SPECIAL,
    startTime: null,
    endTime: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 90,
  },
  {
    code: 'RETEST',
    name: '复测',
    type: TIME_SLOT_CATEGORY.SPECIAL,
    startTime: null,
    endTime: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 100,
  },
  // 强化时段：无区间、无控糖目标
  {
    code: 'INTENSIVE_AM',
    name: '强化-上午',
    type: TIME_SLOT_CATEGORY.INTENSIVE,
    startTime: null,
    endTime: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 110,
  },
  {
    code: 'INTENSIVE_PM',
    name: '强化-下午',
    type: TIME_SLOT_CATEGORY.INTENSIVE,
    startTime: null,
    endTime: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 120,
  },
  {
    code: 'INTENSIVE_NIGHT',
    name: '强化-夜间',
    type: TIME_SLOT_CATEGORY.INTENSIVE,
    startTime: null,
    endTime: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 130,
  },
];

/** 'HH:mm'（两位时分）→ 当日分钟数；非法格式（含 24:00 以外的越界）返回 null */
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) {
    return null;
  }
  return hour * 60 + minute;
}

/**
 * 按检测时间求所属**普通时段**：区间左闭右开 `[startTime, endTime)`，'24:00' 可作终点。
 *
 * @param slots 时段列表（接口下发或 store 缓存）
 * @param time  'HH:mm'，即检测时间的时分
 * @returns 命中的普通时段；无区间/无命中（如数据有空洞）返回 null
 */
export function pickTimeSlotByTime(slots: TimeSlotOption[], time: string): TimeSlotOption | null {
  const minutes = timeToMinutes(time);
  if (minutes === null) {
    return null;
  }

  for (const slot of slots) {
    if (slot.type !== TIME_SLOT_CATEGORY.NORMAL || !slot.enabled) {
      continue;
    }
    if (!slot.startTime || !slot.endTime) {
      continue;
    }
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    if (start === null || end === null || end <= start) {
      continue;
    }
    if (minutes >= start && minutes < end) {
      return slot;
    }
  }

  return null;
}

// 此处曾有 `DEFAULT_ALERT_RANGE = { low: 3.9, high: 16.7 }` 占位常量，已于 2026-11-17 删除。
// 血糖告警阈值一律存 `SystemConfig` 表（key: `glucose.low_threshold` / `glucose.high_threshold`），
// 由服务端 `SystemConfigService.getGlucoseAlertThreshold()` 读取并校验。
// **禁止**在共享包或业务代码里重新引入默认阈值常量：那会让"改配置不生效"这类问题无声发生，
// 而血糖判定结果直接进病历。配置读不到时服务端抛 10000 拒绝写入，不退回默认值。
// 注意：全局告警阈值与时段控糖目标（`TimeSlot.valueDown` / `valueUp`）不是同一概念，后者按时段细化。
