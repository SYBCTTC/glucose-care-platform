import type { PatientListItem, PatientStatus } from '@gc/shared';
import { http } from './client';

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

/** 住院 / 出院患者列表：两个接口权限点独立 */
export function fetchPatients(
  status: PatientStatus,
  params: PatientListParams,
): Promise<PatientListResult> {
  const path = status === 'INPATIENT' ? '/patients/inpatient' : '/patients/discharged';
  return http.get<PatientListResult>(path, params);
}
