import type { DiabetesType, Gender, PatientListItem, PatientStatus } from '@gc/shared';
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

/** 住院 / 出院患者列表：两个接口权限点独立 */
export function fetchPatients(
  status: PatientStatus,
  params: PatientListParams,
): Promise<PatientListResult> {
  const path = status === 'INPATIENT' ? '/patients/inpatient' : '/patients/discharged';
  return http.get<PatientListResult>(path, params);
}
