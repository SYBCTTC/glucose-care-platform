import { z } from 'zod';
import { dateTimeStringSchema } from '../date';
import type { TIME_SLOT_CATEGORY, TimeSlotCategory } from '../dict/time-slots';
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

/**
 * DY-RESULT 契约码（统计栏口径，R20）：合格=正常('1')；血糖仪超上限 High('4') / 超下限 Low('3')。
 * 前端据此**取字典 label/color**，禁止硬编码文案与色值（COMMON-DATA 硬规则）。
 */
export const GLUCOSE_RESULT_CODE_NORMAL = '1';
export const GLUCOSE_RESULT_CODE_LOW = '3';
export const GLUCOSE_RESULT_CODE_HIGH = '4';

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
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, '血糖值最多 1 位小数');

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

/* -------------------------------------------------------------------------- */
/* R25 血糖详情 / 编辑 / 作废（2026-11-20 裁定，docs/specs/glucose-report-edit.md） */
/* -------------------------------------------------------------------------- */

/**
 * 详情/编辑/作废路由参数。
 * `:id` 是患者（审计 targetId 取它，拦截器只认 `params.id`）；`:recordId` 是血糖记录。
 */
export const glucoseRecordParamsSchema = z.object({
  id: z.string().uuid('患者 ID 不合法'),
  recordId: z.string().uuid('血糖记录 ID 不合法'),
});

/**
 * 单条血糖详情（GET /patients/:id/glucose/:recordId，R25）。
 * 编辑弹框回填与 review 展示的数据源；已作废/不存在/不属于该患者 → 41001。
 * 时段名称不在响应里：前端按 `mealContext` code 查动态时段（含停用项回显），禁止服务端下发第二份名称口径。
 */
export interface GlucoseRecordDetail {
  id: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间（与报表口径一致） */
  measuredAt: string;
  mealContext: string | null;
  /** '0'~'9'，前端取字典 label/color */
  resultType: string;
  valueMmolL: number | null;
  testStrip: number | null;
  operatorId: string | null;
  /** 记录者姓名；服务端下发（操作人可能不在本科室 staff 下拉里，同报表 nurseName 口径） */
  operatorName: string | null;
  remark: string | null;
}

/**
 * 编辑保存结果（PATCH /patients/:id/glucose/:recordId，R25）。
 * `changedFields` 只含**字段名**（裁定 Q5，同 PATIENT_UPDATE 口径），
 * 由审计拦截器按既有白名单提取入 detail；remark 等自由文本的值绝不入审计。
 */
export interface GlucoseUpdateResult {
  id: string;
  changedFields: string[];
  /** 落库的结果类型（「检测」已被服务端重判为 0/1/2） */
  resultType: string;
  valueMmolL: number | null;
  /** YYYY-MM-DD HH:mm:ss */
  measuredAt: string;
}

/**
 * 作废结果（DELETE /patients/:id/glucose/:recordId，R25 软删除）。
 * `glucoseRecordId` 供审计拦截器按白名单提取入 detail（先例 wardRecordId）；
 * 审计对象仍是患者（targetType='PATIENT'、targetId=患者 ID）。
 */
export interface GlucoseVoidResult {
  glucoseRecordId: string;
  voided: true;
}

/* -------------------------------------------------------------------------- */
/* 血糖报告（GET /patients/:id/glucose/report）                                 */
/* -------------------------------------------------------------------------- */

/**
 * 血糖报告默认每页**日期数**。
 * ⚠️ 分页单位是「有血糖数据的日期」，**不是**血糖记录条数：
 * 服务端必须先按日期分组、再对日期集合分页，禁止用 Prisma `take`/`skip` 直接切记录。
 */
export const GLUCOSE_REPORT_PAGE_SIZE = 15;

/**
 * 血糖报告查询入参。
 *
 * R24（2026-11-20 裁定 Q16）：原天粒度 `startDate`/`endDate` **升级为秒粒度**
 * `startTime`/`endTime`（破坏性契约变更，前后端同轮改齐）——表单查询按
 * 住院记录/科室记录联动出的时间范围过滤，范围边界是精确到秒的业务时刻。
 *
 * 复用 `dateTimeStringSchema`（YYYY-MM-DD HH:mm:ss → Date，按**本地时区**解析，
 * 与录入侧 `measuredAt` 同口径）；过滤为**闭区间** `measuredAt ∈ [startTime, endTime]`。
 * 行分组、统计栏、分页 total 全部基于过滤后的记录（裁定 Q14）。
 */
export const glucoseReportQuerySchema = z.object({
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime: dateTimeStringSchema.optional(),
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime: dateTimeStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(GLUCOSE_REPORT_PAGE_SIZE),
});
export type GlucoseReportQuery = z.infer<typeof glucoseReportQuerySchema>;

/** 报表列的时段类型：只有普通(1)与特殊(4)成列；强化(0)按检测时间归入普通列，不单独成列 */
export type GlucoseReportColumnType =
  typeof TIME_SLOT_CATEGORY.NORMAL | typeof TIME_SLOT_CATEGORY.SPECIAL;

/**
 * 报表列定义，由**服务端下发**。
 * 前端据此画表头，不读 `useCommonDataStore().timeSlots`——保证表头与归组口径同源、不漂移。
 *
 * R22（2026-11-19 裁定）：只有**启用**的时段成列（原 `enabled` 字段随之移除）。
 * 弃用时段的历史记录不再有自己的列，按检测时间合并进启用的普通列并以后缀标注
 * （见 `GlucoseReportEntry.sourceSlotName`），展示方式与强化时段一致。
 */
export interface GlucoseReportColumn {
  /** TimeSlot.code，落库契约值 */
  code: string;
  /** TimeSlot.name，表头文字（库里维护，前端禁止硬编码、禁止按名称匹配） */
  name: string;
  type: GlucoseReportColumnType;
  sortOrder: number;
}

/** 单元格内的一条血糖记录（前端渲染为两行：`值[(HH:mm)][(来源时段名)]` / 记录者） */
export interface GlucoseReportEntry {
  /** `GlucoseRecord.id`（R25）：点击单元格记录弹 review/编辑框时定位是哪条记录 */
  id: string;
  /** mmol/L；`null` 表示非数值型结果（`resultType` 3~9），前端改显示字典标签 */
  valueMmolL: number | null;
  /** DY-RESULT code '0'~'9'，前端据此取字典 `label` / `color`，不自行比阈值 */
  resultType: string;
  /** HH:mm，**本地时间** */
  time: string;
  /** 记录者姓名（`User.name`）；`operatorId` 为空时为 null，前端显示 `-` */
  nurseName: string | null;
  /**
   * 记录的**原时段类型**（R22）：0 强化 / 1 普通 / 4 特殊。
   * 前端展示勾选项据此过滤：普通来源受「常规血糖」、强化来源受「强化血糖」控制，
   * 特殊来源（含弃用的特殊时段）恒展示且时间恒展示（裁定：按原时段类型跟随勾选）。
   * 归组失败兜底落随机列的记录按特殊对待——宁可多展示，不可丢数据。
   */
  sourceType: TimeSlotCategory;
  /**
   * 后缀标注的来源时段名（R22，泛化自原 `intensiveName`）：
   * 强化时段名（如「强化-上午」）或**弃用时段自己的名称**（如「复测」，裁定 Q1）；
   * 启用的普通/特殊记录落自己的列时为 null。
   */
  sourceSlotName: string | null;
}

/** 一个「日期 × 时段」单元格 */
export interface GlucoseReportCell {
  /** 对应 `columns[i].code` */
  slotCode: string;
  /** 同日同时段多条 → 按 `measuredAt` **升序**堆叠 */
  entries: GlucoseReportEntry[];
}

/** 一个日期行 */
export interface GlucoseReportRow {
  /** YYYY-MM-DD，**本地日期**（非 UTC） */
  date: string;
  /** 与 `columns` **等长同序**；无数据的列 `entries` 为空数组 */
  cells: GlucoseReportCell[];
}

/**
 * 报表统计栏（R20，2026-11-19 需求人裁定）：按查询范围内**全部记录**统计，
 * **与分页无关**（翻页不变）；后续新增筛选条件（时间/住院记录/科室）时跟随同一条件。
 * 由服务端计算后随报表响应下发，前端不自行聚合。
 */
export interface GlucoseReportStats {
  /**
   * 总计：`resultType` 属于字典 `counted=true` 集合的记录数（当前种子为 0~4；
   * 拒检/外出/请假/已吃饭/未进食等 5~9 不计入）。集合以 **DictItem.counted 数据为准**，
   * 服务端查字典计算，不在代码里固化码集。
   */
  total: number;
  /** 合格次数：`resultType = '1'`（正常）的记录数 */
  qualified: number;
  /** 范围内是否存在 High('4') 记录：true 时「最高血糖」展示字典 label 而非数值 */
  hasHigh: boolean;
  /** 范围内是否存在 Low('3') 记录：true 时「最低血糖」展示字典 label 而非数值 */
  hasLow: boolean;
  /** 数值型(0/1/2)记录的最大值；无数值记录为 null（展示 `-`）。展示口径 `toFixed(1)` + ` mmol/L` */
  maxValueMmolL: number | null;
  /** 最大值记录自身的 resultType，前端按其字典色着色（裁定 2）；无数值记录为 null */
  maxResultType: string | null;
  /** 数值型(0/1/2)记录的最小值；无数值记录为 null */
  minValueMmolL: number | null;
  /** 最小值记录自身的 resultType，前端按其字典色着色；无数值记录为 null */
  minResultType: string | null;
}

export interface GlucoseReportResponse {
  /** **启用的**普通 + 特殊时段，按 `sortOrder` 升序（R22：弃用时段不成列） */
  columns: GlucoseReportColumn[];
  /** 按日期**降序**（最新在前）；只含有数据的日期，**不补空行** */
  rows: GlucoseReportRow[];
  /** **日期总数**，不是记录总数 */
  total: number;
  page: number;
  pageSize: number;
  /**
   * 实际生效的查询区间（R24 起为本地时刻 YYYY-MM-DD HH:mm:ss，秒粒度）；未传时为 null。
   * 回显这三个字段是为了让 `AuditLogInterceptor` 按既有 `AUDIT_DETAIL_ALLOW_LIST`
   * 自动把查询区间与条数落进审计 detail，**无需改白名单**。
   */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** 本页血糖记录条数，同为审计 detail 而回显 */
  count: number;
  /** 统计栏数据（R20）：按查询范围全量统计，与分页无关 */
  stats: GlucoseReportStats;
}

/* -------------------------------------------------------------------------- */
/* R27 血糖记录列表（GET /patients/:id/glucose/records）                        */
/* -------------------------------------------------------------------------- */

/**
 * 血糖记录列表每页固定 **15 条记录**（R27 规则 5，2026-11-23 裁定）。
 * ⚠️ 与 `GLUCOSE_REPORT_PAGE_SIZE` 数字相同但语义不同：那边分页单位是「日期」，
 * 这边是「血糖记录条数」。独立常量，禁止互相引用。
 */
export const GLUCOSE_RECORD_PAGE_SIZE = 15;

/**
 * 血糖记录列表查询入参（R27）。
 *
 * 时间过滤与报表契约同口径：秒粒度本地时间、闭区间 `measuredAt ∈ [startTime, endTime]`、
 * 单侧不传则该侧不限（复用 `dateTimeStringSchema`，服务端 `resolveTimeRange` 同一实现）。
 * `pageSize` 默认 15，前端不提供条数切换器；`max(100)` 仅服务端防御。
 */
export const glucoseRecordQuerySchema = z.object({
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime: dateTimeStringSchema.optional(),
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime: dateTimeStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(GLUCOSE_RECORD_PAGE_SIZE),
});
export type GlucoseRecordQuery = z.infer<typeof glucoseRecordQuerySchema>;

/**
 * 血糖记录列表行（R27 规则 2 的 5 个展示字段 + 定位/渲染辅助字段）。
 * 只含**有效**记录（voidedAt null，全仓不变量，裁定 Q2）；
 * 结果类型 0~9 全量下发不做过滤（规则 3，裁定 Q8：5~9 列表可见但不计入统计总计）。
 */
export interface GlucoseRecordListItem {
  id: string;
  /** YYYY-MM-DD HH:mm:ss 本地时间；前端展示截到分钟（规则 2），排序/查询用秒级全量 */
  measuredAt: string;
  /** 时段 code；前端按 code 查动态时段名（含停用项回显），null → '-' */
  mealContext: string | null;
  /** DY-RESULT code '0'~'9'；前端取字典 label/color（裁定 Q3），禁止硬编码 */
  resultType: string;
  /** mmol/L；非数值型(3~9)为 null，前端改显示字典标签 */
  valueMmolL: number | null;
  /** 检测人 = 记录者姓名（与报表 nurseName 同源，服务端 join 下发）；null → '-' */
  operatorName: string | null;
  /** 备注；null → '-' */
  remark: string | null;
}

export interface GlucoseRecordListResponse {
  /** 按 measuredAt DESC + id ASC（裁定 Q5：最新在前，id 第二键防同秒页漂移） */
  items: GlucoseRecordListItem[];
  /** 过滤后总记录条数（分页依据，规则 5） */
  total: number;
  page: number;
  pageSize: number;
  /** 实际生效的查询区间回显（审计 detail 同源，同报表契约，白名单零改动） */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** 本页条数 */
  count: number;
  /** 统计栏：复用报表统计类型与口径（裁定 Q8），同范围下与报表 Tab 数字完全一致 */
  stats: GlucoseReportStats;
}

/* -------------------------------------------------------------------------- */
/* 血糖趋势图（GET /patients/:id/glucose/trend，P3-7）                           */
/* -------------------------------------------------------------------------- */

/**
 * 血糖趋势查询入参（P3-7，2026-11-24 裁定）。
 *
 * 时间口径与报表/记录契约**一字不差**：秒粒度本地时间、闭区间 `measuredAt ∈ [startTime, endTime]`、
 * 单侧不传则该侧不限（复用 `dateTimeStringSchema`，服务端 `resolveTimeRange` 同一实现）。
 *
 * ⚠️ **无 page/pageSize**：趋势图不分页，返回范围内全部数值点。范围由前端查询表单按住院记录
 * 默认收敛；大数据量由 ECharts `sampling:'lttb'` + `large:true` 承接（glucose-domain 图表节）。
 */
export const glucoseTrendQuerySchema = z.object({
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime: dateTimeStringSchema.optional(),
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime: dateTimeStringSchema.optional(),
  /**
   * 时段过滤（2026-11-24 增补）：按记录的 `mealContext` 码筛选趋势点与统计。
   *
   * 前端以**逗号分隔字符串**下发（`http.get` 用 `URLSearchParams` 序列化，数组会被 `String()`
   * 拼成 `A,B,C`），这里 transform 还原为数组；缺省/空串 → `undefined`/`[]`，服务端视为**不过滤**
   * （即「全部」：返回范围内全部数值记录，含停用时段 mealContext 的历史记录，与无此参数时一致）。
   * 只做格式拆分、不做白名单：code 是否存在/启用同 `mealContext`（动态时段，服务端查库）。
   */
  mealContexts: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
    )
    .optional(),
});
export type GlucoseTrendQuery = z.infer<typeof glucoseTrendQuerySchema>;

/**
 * 趋势图上的一个**原始测量点**（裁定：图表形态=原始测量点散点/折线，不做按日聚合）。
 *
 * 只含**数值型**结果（`resultType` 0/1/2，`valueMmolL` 非空）：3~9 无读数无法在值轴描点，
 * 不成点（但仍计入 `stats.total`，同报表口径）。恒为**有效**记录（voidedAt null，全仓不变量）。
 */
export interface GlucoseTrendPoint {
  /** `GlucoseRecord.id`：点击数据点打开 R25 复核弹窗时定位是哪条记录 */
  id: string;
  /** YYYY-MM-DD HH:mm:ss 本地时间；前端作时间轴 X 值 */
  measuredAt: string;
  /** mmol/L；数值型记录恒有值，前端作 Y 值 */
  valueMmolL: number;
  /** DY-RESULT code '0'|'1'|'2'；前端取字典 label/color 着色，禁止硬编码 */
  resultType: string;
  /** 记录者姓名（tooltip 展示，glucose-domain 图表节硬要求）；`operatorId` 为空时 null，前端显示 '-' */
  operatorName: string | null;
}

/**
 * 血糖趋势响应。
 *
 * `thresholds` 由服务端从 `SystemConfig`（`glucose.low_threshold`/`glucose.high_threshold`）读取下发，
 * 前端据此画阈值线与目标范围带，**禁止硬编码阈值**（裁定：沿用告警阈值，接口下发）。
 * `stats` 复用报表统计类型与口径（裁定：复用报表统计口径），同范围下与报表/记录 Tab 数字完全一致。
 */
export interface GlucoseTrendResponse {
  /** 数值型有效测量点，按 `measuredAt` **升序**（时间顺序）；无数据为空数组 */
  points: GlucoseTrendPoint[];
  /** 告警阈值（mmol/L），前端画低/高阈值线与目标范围带 */
  thresholds: { low: number; high: number };
  /** 统计栏：复用报表统计类型与口径，按查询范围全量、与分页无关 */
  stats: GlucoseReportStats;
  /**
   * 实际生效的查询区间回显（本地时刻 YYYY-MM-DD HH:mm:ss）；未传时为 null。
   * 与报表/记录同因：让 `AuditLogInterceptor` 按既有 `AUDIT_DETAIL_ALLOW_LIST` 自动落审计 detail，无需改白名单。
   */
  rangeFrom: string | null;
  rangeTo: string | null;
  /** 本响应点数（= points.length），同为审计 detail 而回显 */
  count: number;
  /**
   * 实际生效的时段过滤回显（`mealContext` 码数组）；未过滤（「全部」）时为 null。
   * 与 `rangeFrom`/`rangeTo`/`count` 同因：让审计 detail 自洽——`count` 随时段过滤变化，
   * 不回显过滤条件则事后无法解释「同范围下 count 为何不同」。
   */
  mealContexts: string[] | null;
}

/* -------------------------------------------------------------------------- */
/* 血糖数据打印留痕（POST /patients/:id/glucose/print，R28）                      */
/* -------------------------------------------------------------------------- */

/** 打印类型（R28 裁定 Q10：单一审计枚举 GLUCOSE_PRINT，以 detail.printType 区分三种打印） */
export const GLUCOSE_PRINT_TYPES = ['report', 'record', 'trend'] as const;
export type GlucosePrintType = (typeof GLUCOSE_PRINT_TYPES)[number];

/**
 * 打印留痕入参（R28，裁定 Q11）。**纯留痕端点**：不生成文件、不返回血糖数据；
 * 前端在预览 Modal 点「打印」时调用，成功后才触发 `window.print`。
 *
 * 时间口径与报表/记录契约一致（秒粒度本地时间，回显实际生效区间供审计 detail）；
 * `count` = 打印范围内 counted=true 记录数（各 Tab 既有接口 `stats.total` 同口径，
 * 服务端算、前端透传，规格 §4 裁定 17）。
 */
export const glucosePrintSchema = z.object({
  printType: z.enum(GLUCOSE_PRINT_TYPES, {
    errorMap: () => ({ message: '打印类型不合法' }),
  }),
  /** YYYY-MM-DD HH:mm:ss，本地时间；不传则不限起点（同 R24 契约） */
  startTime: dateTimeStringSchema.optional(),
  /** YYYY-MM-DD HH:mm:ss，本地时间；不传则不限终点 */
  endTime: dateTimeStringSchema.optional(),
  /** 打印范围内 counted=true 血糖记录数（审计 detail 用） */
  count: z
    .number({ invalid_type_error: '打印条数不合法' })
    .int('打印条数必须为整数')
    .min(0, '打印条数不能为负')
    .max(10_000_000, '打印条数不合法'),
});
export type GlucosePrintInput = z.infer<typeof glucosePrintSchema>;

/**
 * 打印留痕响应：回显审计 detail 字段。
 * `rangeFrom`/`rangeTo`/`count` 走既有白名单；`printType` 需登记 `AUDIT_DETAIL_ALLOW_LIST`（先例 `mealContexts`）。
 */
export interface GlucosePrintResult {
  printType: GlucosePrintType;
  rangeFrom: string | null;
  rangeTo: string | null;
  count: number;
}
