import { z } from 'zod';
import { dateOnlyStringSchema, dateTimeStringSchema } from '../date';

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
  /** 未说明：新增建档时的"拒绝/不便提供"选项，与历史 UNKNOWN(未知) 区分 */
  UNSPECIFIED: 'UNSPECIFIED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Gender = (typeof GENDER)[keyof typeof GENDER];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: '男',
  FEMALE: '女',
  UNSPECIFIED: '未说明',
  UNKNOWN: '未知',
};

/** 建档时可选的性别（UNKNOWN 为历史数据兜底，不在下拉中出现） */
export const GENDER_SELECTABLE: Gender[] = [GENDER.MALE, GENDER.FEMALE, GENDER.UNSPECIFIED];

/** 糖尿病类型（D-DIABETES）：静态字典，落库存 code，展示用 LABELS */
export const DIABETES_TYPE = {
  TYPE_1: 'TYPE_1',
  TYPE_2: 'TYPE_2',
  GESTATIONAL: 'GESTATIONAL',
  SPECIAL: 'SPECIAL',
  OTHER: 'OTHER',
} as const;
export type DiabetesType = (typeof DIABETES_TYPE)[keyof typeof DIABETES_TYPE];

export const DIABETES_TYPE_LABELS: Record<DiabetesType, string> = {
  TYPE_1: 'I型糖尿病',
  TYPE_2: 'II型糖尿病',
  GESTATIONAL: '妊娠型糖尿病',
  SPECIAL: '特殊型糖尿病',
  OTHER: '其他',
};

/** 糖化血红蛋白（HbA1c）：百分比，0~100，最多 1 位小数 */
export const HBA1C_MIN = 0;
export const HBA1C_MAX = 100;
export const HBA1C_UNIT = '%';

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

/** 糖化血红蛋白：0~100（%），最多 1 位小数 */
const hba1cSchema = z.coerce
  .number()
  .min(HBA1C_MIN, `糖化血红蛋白不能小于 ${HBA1C_MIN}`)
  .max(HBA1C_MAX, `糖化血红蛋白不能大于 ${HBA1C_MAX}`)
  .refine(
    (value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9,
    '糖化血红蛋白最多 1 位小数',
  );

/** 建档状态：本期仅支持"住院患者"，出院流转由后续出院操作产生 */
const createStatusSchema = z
  .nativeEnum(PATIENT_STATUS)
  .default(PATIENT_STATUS.INPATIENT)
  .refine((value) => value === PATIENT_STATUS.INPATIENT, '建档时状态只能是「住院患者」');

/** 出生日期：YYYY-MM-DD，不允许晚于今天 */
const birthDateSchema = dateOnlyStringSchema.refine(
  (value) => value.getTime() <= Date.now(),
  '出生日期不能晚于今天',
);

export const createPatientSchema = z.object({
  name: z.string().trim().min(1, '请输入患者姓名').max(32, '姓名过长'),
  gender: z.nativeEnum(GENDER, { errorMap: () => ({ message: '请选择性别' }) }),
  birthDate: birthDateSchema,
  /** 住院号 / 门诊号，院内唯一 */
  patientNo: z.string().trim().min(1, '请输入住院号').max(32, '住院号过长'),
  idCard: idCardSchema,
  phone: phoneSchema,
  departmentId: z.string().uuid('请选择科室'),
  bedNo: z.string().trim().max(32, '床号过长').optional(),
  /** 责任医生，须属于所选科室 */
  doctorId: z.string().uuid('责任医生不合法').optional(),
  /** 责任护士，须属于所选科室 */
  nurseId: z.string().uuid('责任护士不合法').optional(),
  diabetesType: z.nativeEnum(DIABETES_TYPE).optional(),
  hba1c: hba1cSchema.optional(),
  admissionAt: dateTimeStringSchema,
  status: createStatusSchema,
  remark: z.string().trim().max(255).optional(),
});
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/**
 * 患者信息编辑（PATCH /patients/:id）契约。
 *
 * 字段分两类语义，不要混用：
 *  ① 敏感字段（姓名/身份证/手机号）：**省略 = 不修改**。
 *     密文不可逆，前端无法回填明文，只能「留空不改 / 填新值覆盖 / null 显式清除」。
 *  ② 非敏感字段：**整表单覆盖**，前端总是传，null 表示清空。
 *
 * 住院号 / 入院时间 / 状态由 schema omit 掉：这三个字段编辑时不可更改，
 * 前端也不传；即使多传也会被 Zod strip 丢弃。
 */
export const updatePatientSchema = createPatientSchema
  .omit({ patientNo: true, admissionAt: true, status: true })
  .partial()
  .extend({
    // ① 敏感字段：只有显式给出新值才写库
    name: z.string().trim().min(1, '请输入患者姓名').max(32, '姓名过长').optional(),
    idCard: idCardSchema.nullable(),
    phone: phoneSchema.nullable(),
    // ② 非敏感字段：覆盖式提交，null = 清空
    gender: z.nativeEnum(GENDER, { errorMap: () => ({ message: '请选择性别' }) }),
    birthDate: birthDateSchema,
    departmentId: z.string().uuid('请选择科室'),
    bedNo: z.string().trim().max(32, '床号过长').nullable(),
    doctorId: z.string().uuid('责任医生不合法').nullable(),
    nurseId: z.string().uuid('责任护士不合法').nullable(),
    diabetesType: z.nativeEnum(DIABETES_TYPE).nullable(),
    hba1c: hba1cSchema.nullable(),
  });
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
  /** 最近一次血糖结果类型，取值见 DICT_TYPE.GLUCOSE_RESULT（'0'~'9'） */
  lastGlucoseResultType: string | null;
  /** 最近一次血糖值，mmol/L；非数值类型（'3'~'9'）为 null */
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
  /** YYYY-MM-DD */
  birthDate: string | null;
  remark: string | null;
  /** 责任护士 ID：编辑弹窗回填用，列表接口不返回 */
  nurseId: string | null;
  diabetesType: DiabetesType | null;
  /** 糖化血红蛋白（%） */
  hba1c: number | null;
  devices: Array<{ id: string; sn: string; model: string; status: string }>;
}

/**
 * 患者信息编辑结果。
 * - changedFields：变更字段名（供审计留痕，不含任何值）；为空表示未做修改
 * - item：更新后的列表项，供前端局部更新卡片/表格，避免整页重查丢失滚动位置
 */
export interface PatientUpdateResult {
  id: string;
  changedFields: string[];
  item: PatientListItem;
}

/**
 * 办理住院（重新入院）结果：状态流转 DISCHARGED → INPATIENT。
 * - fromStatus / toStatus：供审计留痕，只有状态码，不含患者信息
 * - item：流转后的列表项，前端直接替换该行，避免整页重查
 */
export interface PatientAdmitResult {
  id: string;
  fromStatus: PatientStatus;
  toStatus: PatientStatus;
  item: PatientListItem;
}
