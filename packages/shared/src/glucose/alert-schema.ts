import { z } from 'zod';
import { dateTimeStringSchema } from '../date';

/**
 * 住院管理-预警管理契约（P4-7，docs/specs/glucose-alerts.md）。
 *
 * 预警判定 = **落库 resultType**（裁定 R1-Q1）：'2' 高于正常 → 高血糖预警、
 * '0' 低于正常 → 低血糖预警；查询时不重判、不读 PatientAlertThreshold（R7：
 * 预警值只服务趋势图阈值线）。注意 `GLUCOSE_RESULT_CODE_LOW/HIGH`（'3'/'4'）
 * 是血糖仪超量程 Low/High 的 DY-RESULT 契约码，无数值读数，**不参与预警**。
 */

/** 预警类型（Tab）：high=高血糖预警，low=低血糖预警；接口缺省 type = 所有预警 */
export const GLUCOSE_ALERT_TYPES = ['high', 'low'] as const;
export type GlucoseAlertType = (typeof GLUCOSE_ALERT_TYPES)[number];

/** 预警类型 → 落库结果类型码（R4：写入时按控糖目标判定，'0' 低于正常 / '2' 高于正常） */
export const GLUCOSE_ALERT_RESULT_CODES: Record<GlucoseAlertType, string> = {
  high: '2',
  low: '0',
};

/** 住院状态筛选：all=不限；inpatient/discharged 对应 Patient.status（INPATIENT/DISCHARGED） */
export const ALERT_ADMISSION_STATUSES = ['all', 'inpatient', 'discharged'] as const;
export type AlertAdmissionStatus = (typeof ALERT_ADMISSION_STATUSES)[number];

/**
 * 大于/小于筛选值（裁定 R2-Q4 宽松校验）：正数、至多 1 位小数。
 * 对原始字符串做正则校验再转数值——先 Number 再判小数位有浮点陷阱（如 4.3*10 !== 43）。
 * valueGt ≥ valueLt 不强拦，允许查出空结果（同裁定）。
 */
const alertBoundSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d)?$/, '大于/小于须为正数且至多 1 位小数')
  .transform(Number)
  .refine((value) => value > 0, '大于/小于须大于 0');

/**
 * 预警列表查询（GET /glucose/alerts）。
 * 时间口径由前端计算后恒送 startTime/endTime（预设规则见规格 §4 规则 3），
 * 作用于 measuredAt，秒级闭区间，同 R24/R27 血糖查询惯例。
 */
export const glucoseAlertQuerySchema = z
  .object({
    /** 缺省 = 所有预警（resultType IN ('0','2')） */
    type: z.enum(GLUCOSE_ALERT_TYPES).optional(),
    departmentId: z.string().uuid().optional(),
    /** 责任医生（Patient.doctorId），随科室联动 */
    doctorId: z.string().uuid().optional(),
    /** 住院号，模糊（contains + insensitive，同患者管理） */
    patientNo: z.string().trim().max(32).optional(),
    /** 姓名，密文确定性等值（同患者管理，不支持模糊） */
    name: z.string().trim().max(32).optional(),
    /** 床号，模糊 */
    bedNo: z.string().trim().max(32).optional(),
    /** 默认查住院（需求默认态） */
    admissionStatus: z.enum(ALERT_ADMISSION_STATUSES).default('inpatient'),
    /** YYYY-MM-DD HH:mm:ss 本地秒级，闭区间起 */
    startTime: dateTimeStringSchema,
    /** 闭区间止；自选区间时 = 结束日 23:59:59（裁定 R1-Q4） */
    endTime: dateTimeStringSchema,
    /** 血糖值 > valueGt（与 valueLt / Tab 类型 AND 叠加，裁定 R1-Q2） */
    valueGt: alertBoundSchema.optional(),
    /** 血糖值 < valueLt */
    valueLt: alertBoundSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((query) => query.startTime.getTime() <= query.endTime.getTime(), {
    message: '开始时间不能晚于结束时间',
    path: ['startTime'],
  });
export type GlucoseAlertQuery = z.infer<typeof glucoseAlertQuerySchema>;

/** 控糖范围：查询时实时解析（患者时段目标 → 缺行回退全局）；null = 解析失败，前端显示 '-' */
export interface GlucoseAlertTargetRange {
  low: number;
  high: number;
}

export interface GlucoseAlertItem {
  /** GlucoseRecord.id */
  id: string;
  departmentName: string | null;
  bedNo: string | null;
  /** 脱敏姓名（nameMasked），本页无解掩入口 */
  name: string;
  /** GENDER 码，前端 GENDER_LABELS 映射 */
  gender: string | null;
  /** 住院号 */
  patientNo: string | null;
  alertType: GlucoseAlertType;
  /** mmol/L，1 位小数；resultType '0'/'2' 必有读数（判定前提） */
  valueMmolL: number;
  /** YYYY-MM-DD HH:mm:ss（同 R27 记录列表口径） */
  measuredAt: string;
  /** 时段码原样返回，前端 getTimeSlotName 转名（含停用时段，历史回显） */
  mealContext: string | null;
  targetRange: GlucoseAlertTargetRange | null;
  /** 责任医生（出院患者 = 末次住院值，同患者管理口径） */
  doctorName: string | null;
  nurseName: string | null;
}

/** 统计：随当前 Tab + 全部筛选变化，不受分页影响（裁定 R2-Q1） */
export interface GlucoseAlertStats {
  /** 去重患者数（同一患者多条 / 兼有高低只计 1 人） */
  patientCount: number;
  totalCount: number;
  /** 当前筛选下高血糖预警次数（type='low' 时为 0） */
  highCount: number;
  /** 当前筛选下低血糖预警次数（type='high' 时为 0） */
  lowCount: number;
}

export interface GlucoseAlertListResponse {
  items: GlucoseAlertItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: GlucoseAlertStats;
  /**
   * 以下为审计回显字段（AuditLogInterceptor 按 AUDIT_DETAIL_ALLOW_LIST 白名单提取，
   * 同 R27 记录列表的 rangeFrom/rangeTo/count 口径）；alertType = type ?? 'all'。
   */
  rangeFrom: string;
  rangeTo: string;
  count: number;
  alertType: GlucoseAlertType | 'all';
}
