import { z } from 'zod';
import { GLUCOSE_VALUE_MAX, GLUCOSE_VALUE_MIN, MEAL_CONTEXT_MAX } from '../glucose/schema';

/**
 * 患者控糖目标契约：各时段血糖上下限 + 低/高血糖预警值。
 * 规格 `docs/specs/patient-glucose-target.md` §3 §4（裁定 J / N / R / S / U / V）。
 *
 * 为什么单独成文件而不并入 `./schema.ts`：后者已 320 行，超 `AGENTS.md` §7「单文件建议 ≤ 300 行」。
 */

/**
 * 阈值数值：0.6 ~ 33.3 mmol/L、最多 1 位小数（对齐库列 `DECIMAL(4,1)`，裁定 R）。
 *
 * 与 `glucose/schema.ts` 的 `glucoseValueSchema` 同区间同精度，但**刻意不复用**：
 * 那边文案是「血糖值不能小于…」，这边是「不能小于…」，共用会让表单红字串味
 * （阈值输入框里弹出「血糖值」字样会让医护误解为在说检测读数）。
 * 1 位小数的判定沿用浮点容差写法，避免 4.4 这类值被 IEEE754 表示误差误判。
 */
const thresholdSchema = z
  .number({ invalid_type_error: '请输入数值' })
  .min(GLUCOSE_VALUE_MIN, `不能小于 ${GLUCOSE_VALUE_MIN}`)
  .max(GLUCOSE_VALUE_MAX, `不能大于 ${GLUCOSE_VALUE_MAX}`)
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, '最多 1 位小数');

/**
 * 时段码：**只做格式校验，不做白名单**。
 *
 * 是否属于「展示集合」（enabled && 普通 && 带阈值）只能查库判定，服务端在写库前校验，
 * 不通过返回 10001 + `details[{field:'targets[i].timeSlotCode'}]`。
 * 理由同 `mealContext`（`AGENTS.md` §4.4）：时段是动态数据，拿静态常量做白名单会在
 * 库里新增时段而未同步 shared 时误拒合法提交。长度上限对齐 `TimeSlot.code @db.VarChar(32)`。
 */
const timeSlotCodeSchema = z
  .string({ invalid_type_error: '时段码不合法' })
  .trim()
  .min(1, '时段码不合法')
  .max(MEAL_CONTEXT_MAX, '时段码不合法');

/**
 * PATCH 提交的单个时段目标。三态语义（裁定 V）：
 *  - 两值都给 → 创建或更新该时段目标行
 *  - 两值都为 null → **删除**该目标行（「清空」= 删行，库里不留 null 空壳行）
 *  - 只给一个 → 字段级校验错误 10001（半配置无临床意义，且库列 NOT NULL 存不下）
 */
const targetItemSchema = z.object({
  timeSlotCode: timeSlotCodeSchema,
  valueDown: thresholdSchema.nullable(),
  valueUp: thresholdSchema.nullable(),
});

/** 展示集合当前 8 个时段；上限留足冗余，仅防超长请求体，不作为业务白名单 */
const TARGETS_MAX = 64;

/**
 * 编辑患者控糖目标（`PATCH /patients/:id/glucose-targets`）入参。
 *
 * **全量提交**展示集合内的时段（裁定 N）：后端与库中现有行 diff 出 create / update / delete
 * 三类操作，前端不必区分「新增/修改/删除」，也不必传操作类型。
 *
 * 跨字段校验（裁定 J）：
 *  - 每个时段 `valueDown < valueUp`（**严格**小于；相等会让 0/1/2 判定区间塌缩）
 *  - `lowThreshold < highThreshold`（严格小于）
 *  - **不校验**预警值与时段目标之间的大小关系（裁定 J 明确排除）：两者是独立机制，
 *    预警值默认 3.9/16.7 本就比时段目标（如空腹 4.4~7.0）宽，强行约束会拒绝合法配置
 */
export const updatePatientGlucoseTargetsSchema = z
  .object({
    targets: z.array(targetItemSchema).max(TARGETS_MAX, '时段数量不合法'),
    alert: z.object({
      lowThreshold: thresholdSchema,
      highThreshold: thresholdSchema,
    }),
  })
  .superRefine((input, ctx) => {
    input.targets.forEach((item, index) => {
      const { valueDown, valueUp } = item;
      const downMissing = valueDown === null;
      const upMissing = valueUp === null;

      if (downMissing !== upMissing) {
        // 只空一个：issue 挂在缺失的那个字段上，前端 form.setFields 才能定位到具体输入框
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', index, downMissing ? 'valueDown' : 'valueUp'],
          message: '上下限需同时填写或同时清空',
        });
        return;
      }
      if (valueDown !== null && valueUp !== null && valueDown >= valueUp) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', index, 'valueUp'],
          message: '上限必须大于下限',
        });
      }
    });

    if (input.alert.lowThreshold >= input.alert.highThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['alert', 'highThreshold'],
        message: '高血糖预警值必须大于低血糖预警值',
      });
    }
  });
export type UpdatePatientGlucoseTargetsInput = z.infer<typeof updatePatientGlucoseTargetsSchema>;

/** 展示集合内的单个时段目标（GET / PATCH 响应共用） */
export interface PatientGlucoseTargetItem {
  timeSlotCode: string;
  /** 时段名称，取 `TimeSlot.name`（动态数据，前端禁止硬编码 label，`AGENTS.md` §4.4） */
  timeSlotName: string;
  /** 患者已配置的目标；null = 该时段缺行 =「未设置」（裁定 K） */
  valueDown: number | null;
  valueUp: number | null;
  /** `TimeSlot` 当前默认值，供编辑弹框「恢复默认」按钮使用（裁定 S）；展示集合内必非空 */
  defaultValueDown: number;
  defaultValueUp: number;
}

/**
 * `GET /patients/:id/glucose-targets` 响应。
 *
 * `targets` 是**展示集合**（裁定 U）：`TimeSlot` 中满足
 * `enabled && type === 1(普通) && valueDown != null && valueUp != null`，按 `sortOrder` 升序。
 * 当前命中 8 个（空腹/早餐前后/午餐前后/晚餐前后/睡前），但**动态跟随库数据**：
 * 将来新增带阈值的普通时段自动入列，停用或清空阈值的自动退出（裁定 K / R10）。
 */
export interface PatientGlucoseTargetsResponse {
  targets: PatientGlucoseTargetItem[];
  alert: {
    /** 患者级预警值；null = 该行不存在（裁定 Q 建档初始化失败 / 存量尚未回填） */
    lowThreshold: number | null;
    highThreshold: number | null;
    /** 当前全局 `SystemConfig` 值，供「恢复默认」使用；读取失败时为 null（裁定 Q：不阻断查询） */
    defaultLowThreshold: number | null;
    defaultHighThreshold: number | null;
  };
}

/**
 * `PATCH` 结果 = 完整响应 + 变更字段名。
 *
 * `changedFields` 是**字段名数组（只记名、不记值）**，与 `PATIENT_UPDATE` / `GLUCOSE_UPDATE`
 * 同口径（`audit.decorator.ts` 白名单注释「只记字段名，不记值」、裁定 Q5）。
 * 时段级变更用复合名精确定位：`FASTING.valueDown`、`FASTING.valueUp`、
 * `FASTING`（整行新增或删除）、`alert.lowThreshold`、`alert.highThreshold`。
 *
 * 空数组 = 提交值与库中完全一致。此时**仍写一行 `SUCCESS` 审计**：`audit-log.interceptor.ts`
 * 命中 `@Audit` 即无条件写入，架构上不支持按业务结果跳过，与 `PATIENT_UPDATE` / `GLUCOSE_UPDATE`
 * 同口径；「不产生噪声」的正确含义是空数组可被审计查询过滤，而不是不写行（规格 §5.2）。
 * 扁平结构（而非嵌套 `item`）是为了让审计拦截器能从响应信封 `data` 顶层直接提取该字段。
 */
export interface PatientGlucoseTargetsUpdateResult extends PatientGlucoseTargetsResponse {
  changedFields: string[];
}
