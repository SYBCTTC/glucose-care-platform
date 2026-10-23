import { z } from 'zod';
import { dateTimeStringSchema } from '../date';

/**
 * 患者领域契约（前后端共享）。
 * 安全约定：
 *  1. 出参一律使用"脱敏对象"（PatientListItem / PatientDetail），
 *     严禁把 nameCipher / idCardCipher / phoneCipher 返回前端。
 *  2. 建档入参中证件号、手机号允许为空，
 *     但一旦有值必须在服务端加密后落库。
 */

export const GENDER = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Gender = (typeof GENDER)[keyof typeof GENDER];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: '男',
  FEMALE: '女',
  UNKNOWN: '未知',
};

/** 患者住院状态：决定患者管理页的 Tab 与查询接口 */
export const PATIENT_STATUS = {
  INPATIENT: 'INPATIENT',
  DISCHARGED: 'DISCHARGED',
} as const;
export type PatientStatus = (typeof PATIENT_STATUS)[keyof typeof PATIENT_STATUS];

export const PATIENT_STATUS_LABELS: Record<PatientStatus, string> = {
  INPATIENT: '住院患者',
  DISCHARGED: '出院患者',
};

/** 中国大陆身份证：18 位，末位可为 X */
export const idCardSchema = z
  .string()
  .trim()
  .regex(/^\d{17}[\dXx]$/, '身份证号格式不正确')
  .optional();

/** 中国大陆手机号 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
  .optional();

export const createPatientSchema = z.object({
  name: z.string().trim().min(1, '请输入患者姓名').max(32, '姓名过长'),
  gender: z.nativeEnum(GENDER).default(GENDER.UNKNOWN),
  birthDate: z.coerce.date().optional(),
  /** 住院号 / 门诊号 */
  patientNo: z.string().trim().min(1).max(32).optional(),
  idCard: idCardSchema,
  phone: phoneSchema,
  departmentId: z.string().uuid('科室不合法'),
  bedNo: z.string().trim().max(32).optional(),
  remark: z.string().trim().max(255).optional(),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

export const updatePatientSchema = createPatientSchema
  .partial()
  .extend({ id: z.string().uuid('患者 ID 不合法') });
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/**
 * 患者列表查询参数（住院 / 出院共用，status 由路由固定）。
 * 姓名按"确定性密文等值"查询；住院号/床号模糊查询。
 */
export const patientListQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  patientNo: z.string().trim().max(32).optional(),
  name: z.string().trim().max(32).optional(),
  bedNo: z.string().trim().max(32).optional(),
  admissionFrom: dateTimeStringSchema.optional(),
  admissionTo: dateTimeStringSchema.optional(),
  dischargeFrom: dateTimeStringSchema.optional(),
  dischargeTo: dateTimeStringSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

export const patientIdSchema = z.object({
  id: z.string().uuid('患者 ID 不合法'),
});

/** 列表项：仅脱敏字段，不含任何密文 */
export interface PatientListItem {
  id: string;
  nameMasked: string;
  patientNo: string | null;
  gender: string | null;
  bedNo: string | null;
  departmentId: string;
  departmentName: string;
  doctorId: string | null;
  doctorName: string | null;
  status: PatientStatus;
  /** YYYY-MM-DD HH:mm:ss */
  admissionAt: string | null;
  /** YYYY-MM-DD HH:mm:ss */
  dischargeAt: string | null;
  /** YYYY-MM-DD HH:mm:ss */
  archivedAt: string | null;
  /** 由出生日期计算；未知时为 null */
  age: number | null;
  /** 最近一次血糖，mmol/L */
  lastGlucoseValue: number | null;
  /** 最近一次血糖时段，取值见 TIME_SLOTS.code */
  lastGlucoseMealContext: string | null;
  /** 最近一次血糖测量时间，YYYY-MM-DD HH:mm:ss */
  lastGlucoseMeasuredAt: string | null;
}

/**
 * 详情：比列表多返回证件号与手机号的脱敏值。
 * 明文仅在有明确业务需要且二次确认后才返回（见合规清单）。
 */
export interface PatientDetail extends PatientListItem {
  idCardMasked: string | null;
  phoneMasked: string | null;
  birthDate: string | null;
  remark: string | null;
  devices: Array<{ id: string; sn: string; model: string; status: string }>;
}
