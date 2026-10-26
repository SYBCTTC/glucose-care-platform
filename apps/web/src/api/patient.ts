import type {
  DiabetesType,
  Gender,
  PatientDetail,
  PatientListItem,
  PatientStatus,
  PatientUpdateResult,
} from '@gc/shared';
import { http } from './client';

/**
 * 建档请求体（传输格式）。
 * 注意：shared 的 createPatientSchema 会把日期转换成 Date，
 * 这里必须按字符串传输，与后端 Zod 入参一致（YYYY-MM-DD / YYYY-MM-DD HH:mm:ss）。
 */
export interface CreatePatientPayload {
  name: string;
  gender: Gender;
  /** YYYY-MM-DD */
  birthDate: string;
  patientNo: string;
  departmentId: string;
  /** YYYY-MM-DD HH:mm:ss */
  admissionAt: string;
  status: PatientStatus;
  idCard?: string;
  phone?: string;
  bedNo?: string;
  doctorId?: string;
  nurseId?: string;
  diabetesType?: DiabetesType;
  /** 糖化血红蛋白（%），0~100，1 位小数 */
  hba1c?: number;
}

export interface CreatePatientResult {
  id: string;
}

/** 患者列表查询参数（前端以字符串传递，后端用共享 schema 校验） */
export interface PatientListParams {
  [key: string]: string | number | undefined;
  departmentId?: string;
  doctorId?: string;
  patientNo?: string;
  name?: string;
  bedNo?: string;
  admissionFrom?: string;
  admissionTo?: string;
  dischargeFrom?: string;
  dischargeTo?: string;
  page?: number;
  pageSize?: number;
}

export interface PatientListResult {
  items: PatientListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 患者建档（添加患者） */
export function createPatient(payload: CreatePatientPayload): Promise<CreatePatientResult> {
  return http.post<CreatePatientResult>('/patients', payload);
}

/**
 * 患者信息编辑请求体（PATCH /patients/:id）。
 *
 * 字段语义分两类，不要混用：
 *  ① 敏感字段（name / idCard / phone）：**省略 = 不修改**。
 *     密文不可逆，无法回填明文，只能「留空不改 / 填新值覆盖 / null 显式清除」。
 *  ② 非敏感字段：**整表单覆盖**，总是传，null 表示清空。
 *
 * 住院号 / 入院时间 / 状态不可编辑，请求体里没有这三个字段。
 */
export interface UpdatePatientPayload {
  name?: string;
  idCard?: string | null;
  phone?: string | null;
  gender: Gender;
  /** YYYY-MM-DD */
  birthDate: string;
  departmentId: string;
  bedNo: string | null;
  doctorId: string | null;
  nurseId: string | null;
  diabetesType: DiabetesType | null;
  /** 糖化血红蛋白（%），0~100，1 位小数 */
  hba1c: number | null;
}

/** 患者信息编辑（编辑弹窗提交） */
export function updatePatient(
  id: string,
  payload: UpdatePatientPayload,
): Promise<PatientUpdateResult> {
  return http.patch<PatientUpdateResult>(`/patients/${id}`, payload);
}

/** 患者详情（编辑弹窗回填）：属敏感查询，后端会写 PATIENT_VIEW 审计 */
export function fetchPatientDetail(id: string): Promise<PatientDetail> {
  return http.get<PatientDetail>(`/patients/${id}`);
}

/** 住院 / 出院患者列表：两个接口权限点独立 */
export function fetchPatients(
  status: PatientStatus,
  params: PatientListParams,
): Promise<PatientListResult> {
  const path = status === 'INPATIENT' ? '/patients/inpatient' : '/patients/discharged';
  return http.get<PatientListResult>(path, params);
}
