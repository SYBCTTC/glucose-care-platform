import { z } from 'zod';
import { dateTimeStringSchema } from '../date';
import type { PatientListItem } from '../patient/schema';

/**
 * 血糖领域契约（手工录入）。
 * 安全与业务约定：
 *  1. 存储唯一单位 mmol/L，入参只接受 mmol/L，不接受 mg/dL；
 *  2. `0`/`1`/`2`（偏低/正常/偏高）由服务端按阈值判定，**禁止由前端提交**；
 *  3. `3`~`9`（Low/High/拒检/外出/请假/已吃饭/未进食）是人工选择的结果类型，无血糖值；
 *  4. `mealContext` 是动态数据（表 `TimeSlot`）的 code，本契约只校验格式，
 *     "是否存在且启用"由服务端查库判定，不通过返回 `10001` + 字段级 details。
 */

/** 血糖合法范围（mmol/L，含边界），与 AGENTS.md 4.3 一致 */
export const GLUCOSE_VALUE_MIN = 0.6;
export const GLUCOSE_VALUE_MAX = 33.3;
/** 血糖单位：存储与提交唯一单位 */
export const GLUCOSE_UNIT = 'mmol/L';

/** 试纸数量范围（张，整数，不允许小数） */
export const TEST_STRIP_MIN = 0;
export const TEST_STRIP_MAX = 999;

/**
 * 录入界面的「检测」伪选项。
 * 仅作为接口入参哨兵值，**不入库、不进 DY-RESULT**：
 * 提交它表示"这是一次真实读数"，由服务端按阈值判定为 0/1/2。
 */
export const GLUCOSE_ENTRY_DETECT = 'DETECT';

/**
 * 允许用户手选的检测结果类型（DY-RESULT 中 checkable=true 的项）。
 * 与 0/1/2 的区别：3~9 是"结果类型本身"，没有具体读数。
 */
export const GLUCOSE_SELECTABLE_RESULT_CODES = ['3', '4', '5', '6', '7', '8', '9'] as const;
export type GlucoseSelectableResultCode = (typeof GLUCOSE_SELECTABLE_RESULT_CODES)[number];

/** 入参 resultType 的可选值：「检测」+ 3~9；0/1/2 不在其中，防止前端绕过阈值判定 */
export const GLUCOSE_ENTRY_RESULT_TYPES = [
  GLUCOSE_ENTRY_DETECT,
  ...GLUCOSE_SELECTABLE_RESULT_CODES,
] as const;
export type GlucoseEntryResultType = (typeof GLUCOSE_ENTRY_RESULT_TYPES)[number];

/** 数值型结果类型（有具体读数）：只有这三类展示血糖值 */
export const GLUCOSE_VALUE_RESULT_CODES = ['0', '1', '2'] as const;

/** 是否为数值型结果（0/1/2） */
export function isGlucoseValueResult(resultType: string | null | undefined): boolean {
  return resultType !== null && resultType !== undefined
    ? (GLUCOSE_VALUE_RESULT_CODES as readonly string[]).includes(resultType)
    : false;
}

/**
 * 血糖值：0.6 ~ 33.3，最多 1 位小数。
 * 刻意不用 z.coerce：`null` 会被 coerce 成 0，导致"非检测类型"误报范围错误。
 */
const glucoseValueSchema = z
  .number({ invalid_type_error: '请输入血糖值' })
  .min(GLUCOSE_VALUE_MIN, `血糖值不能小于 ${GLUCOSE_VALUE_MIN}`)
  .max(GLUCOSE_VALUE_MAX, `血糖值不能大于 ${GLUCOSE_VALUE_MAX}`)
  .refine(
    (value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9,
    '血糖值最多 1 位小数',
  );

/** 试纸数量：0 ~ 999 的整数，不允许小数 */
const testStripSchema = z
  .number({ invalid_type_error: '试纸数量不合法' })
  .int('试纸数量必须为整数')
  .min(TEST_STRIP_MIN, `试纸数量不能小于 ${TEST_STRIP_MIN}`)
  .max(TEST_STRIP_MAX, `试纸数量不能大于 ${TEST_STRIP_MAX}`);

/**
 * 时段码长度上限，与 `TimeSlot.code @db.VarChar(32)` / `GlucoseRecord.mealContext @db.VarChar(32)` 对齐。
 *
 * 这里**只做格式校验，不做白名单**：时段是动态数据（表 `TimeSlot`，接口 `GET /time-slots`），
 * code 是否存在、是否启用只能查库判断。服务端 `GlucoseService` 在写库前做运行时校验，
 * 不通过返回 `10001` + `{ field: 'mealContext' }`。
 * 曾用 `@gc/shared` 的静态 `TIME_SLOTS` 做白名单，导致库里新增时段而未同步 shared 时误拒合法提交。
 */
export const MEAL_CONTEXT_MAX = 32;

/**
 * 添加血糖（POST /patients/:id/glucose）入参。
 *
 * 条件必填由 superRefine 统一表达：
 *  - 选「检测」→ 血糖值必填，试纸可选；
 *  - 选 3~9 → 血糖值与试纸必须为空（前端置灰并清空）。
 */
export const createGlucoseSchema = z
  .object({
    /** 检测时间，YYYY-MM-DD HH:mm:ss；不得晚于当前时间（容忍 60s 时钟漂移） */
    measuredAt: dateTimeStringSchema.refine(
      (value) => value.getTime() <= Date.now() + 60_000,
      '检测时间不能晚于当前时间',
    ),
    /** 检测时段码，取值见 TimeSlot.code（含「随机」RANDOM）；是否存在且启用由服务端查库校验 */
    mealContext: z
      .string({ invalid_type_error: '请选择检测时段' })
      .trim()
      .min(1, '请选择检测时段')
      .max(MEAL_CONTEXT_MAX, '检测时段不合法'),
    /** 「检测」或 3~9；0/1/2 由服务端判定 */
    resultType: z.enum(GLUCOSE_ENTRY_RESULT_TYPES, {
      errorMap: () => ({ message: '检测结果类型不合法' }),
    }),
    /** 血糖值 mmol/L；仅「检测」时有值 */
    valueMmolL: glucoseValueSchema.nullish(),
    /** 试纸数量；仅「检测」时允许填写 */
    testStrip: testStripSchema.nullish(),
    /** 记录者，须为在职用户 */
    operatorId: z.string().uuid('记录者不合法'),
    remark: z.string().trim().max(500, '备注不能超过 500 字').nullish(),
  })
  .superRefine((input, ctx) => {
    const isDetect = input.resultType === GLUCOSE_ENTRY_DETECT;

    if (isDetect && (input.valueMmolL === null || input.valueMmolL === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valueMmolL'],
        message: '请输入血糖值',
      });
    }

    if (!isDetect && input.valueMmolL !== null && input.valueMmolL !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valueMmolL'],
        message: '非检测类型不能填写血糖值',
      });
    }

    if (!isDetect && input.testStrip !== null && input.testStrip !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['testStrip'],
        message: '非检测类型不能填写试纸数量',
      });
    }
  });
export type CreateGlucoseInput = z.infer<typeof createGlucoseSchema>;

/**
 * 添加血糖结果。
 * `item` 为该患者更新后的列表项，前端直接替换卡片/表格里的行，避免整页重查。
 * `skipped` 为 true 表示该患者该检测时间已有记录（唯一约束 patientId + measuredAt 命中），
 * 本次提交按幂等跳过**未落库**，返回的是已有记录；前端不得提示"添加成功"。
 */
export interface GlucoseCreateResult {
  id: string;
  /** 是否因重复（同患者同检测时间）而跳过写入 */
  skipped: boolean;
  /** 落库的结果类型（「检测」已被判定为 0/1/2） */
  resultType: string;
  valueMmolL: number | null;
  /** YYYY-MM-DD HH:mm:ss */
  measuredAt: string;
  item: PatientListItem;
}
