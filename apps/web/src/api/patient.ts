import type {
  AdmissionsResponse,
  DiabetesType,
  Gender,
  PatientAdmitResult,
  PatientDetail,
  PatientGlucoseTargetsResponse,
  PatientGlucoseTargetsUpdateResult,
  PatientListItem,
  PatientNamePlainResult,
  PatientStatus,
  PatientUpdateResult,
  UpdatePatientGlucoseTargetsInput,
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

/**
 * R28：明文姓名（打印头专用，docs/specs/glucose-print.md §3 接口 1）。
 * 需 `glucose:print` 权限；**每次调用后端记一条 PATIENT_NAME_PLAIN_VIEW 审计**（访问即留痕），
 * 因此只在打开打印预览时调用一次，不得轮询/缓存复用。
 * `name: null` = 密文不可解（历史不可逆密文），调用方回退展示 nameMasked（规格 §4 规则 15）。
 */
export function fetchPatientNamePlain(id: string): Promise<PatientNamePlainResult> {
  return http.get<PatientNamePlainResult>(`/patients/${id}/name-plain`);
}

/**
 * 住院记录树（R24）：报表查询表单「住院记录/科室记录」下拉的数据源。
 * 一次性树形下发（裁定 Q4），前端联动纯本地、不发二级请求。
 * 属敏感查询，后端写 ADMISSION_QUERY 审计并做数据权限校验。
 */
export function fetchAdmissions(id: string): Promise<AdmissionsResponse> {
  return http.get<AdmissionsResponse>(`/patients/${id}/admissions`);
}

/**
 * 办理住院：出院患者重新入院（DISCHARGED → INPATIENT）。
 * 属状态流转类敏感操作，后端写 PATIENT_MANAGE 审计并做数据权限校验。
 */
export function admitPatient(id: string): Promise<PatientAdmitResult> {
  return http.post<PatientAdmitResult>(`/patients/${id}/admit`);
}

/** 住院 / 出院患者列表：两个接口权限点独立 */
export function fetchPatients(
  status: PatientStatus,
  params: PatientListParams,
): Promise<PatientListResult> {
  const path = status === 'INPATIENT' ? '/patients/inpatient' : '/patients/discharged';
  return http.get<PatientListResult>(path, params);
}

/**
 * 患者控糖目标（GET /patients/:id/glucose-targets），规格 §3.1。
 *
 * ⚠️ 属敏感查询：后端**每次调用写一条 `PATIENT_TARGET_VIEW` 审计**（2026-11-25 裁定，
 * 与 `PATIENT_VIEW` / `ADMISSION_QUERY` 同口径），故不得轮询、不得为同一视图重复调用；
 * 调用方 hook 必须带 StrictMode 守卫，否则开发模式下会双写审计行。
 *
 * 返回的 `targets` 是**展示集合**（`enabled` && 普通时段 && 上下限非空，当前 8 个，动态跟随库）；
 * `timeSlotName` 由后端下发，前端**禁止硬编码时段名**（`AGENTS.md` §4.4）。
 * `alert.default*` 为全局 `SystemConfig` 值，供「恢复默认」用；读取失败时为 null（按钮置灰）。
 */
export function fetchPatientGlucoseTargets(id: string): Promise<PatientGlucoseTargetsResponse> {
  return http.get<PatientGlucoseTargetsResponse>(`/patients/${id}/glucose-targets`);
}

/**
 * 编辑患者控糖目标（PATCH /patients/:id/glucose-targets），规格 §3.2。
 * 需 `patient:target:update` 权限 + 患者为住院中；后端写 `PATIENT_TARGET_UPDATE` 审计。
 *
 * **全量提交**展示集合内的时段（裁定 N）：后端与库中现有行 diff 出增 / 改 / 删，
 * 前端不传操作类型。某时段两值都为 `null` = **删除**该目标行（裁定 V，库里不留 null 空壳行）。
 * 校验失败返回 `10001` + `details`（字段级，`field` 形如 `targets[0].valueDown`），
 * 由弹框映射到对应输入框；并发撞唯一索引返回 `10008`。
 */
export function updatePatientGlucoseTargets(
  id: string,
  payload: UpdatePatientGlucoseTargetsInput,
): Promise<PatientGlucoseTargetsUpdateResult> {
  return http.patch<PatientGlucoseTargetsUpdateResult>(`/patients/${id}/glucose-targets`, payload);
}
