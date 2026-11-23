import type {
  GlucoseCreateResult,
  GlucoseRecordDetail,
  GlucoseRecordListResponse,
  GlucoseReportResponse,
  GlucoseUpdateResult,
  GlucoseVoidResult,
} from '@gc/shared';
import { http } from './client';

/**
 * 添加血糖请求体（传输格式）。
 * 注意：shared 的 createGlucoseSchema 会把 measuredAt 转成 Date，
 * 这里必须按字符串传输（YYYY-MM-DD HH:mm:ss）。
 * `resultType` 传 `DETECT` 表示「这是一次真实读数」，由服务端判定 0/1/2。
 */
export interface CreateGlucosePayload {
  /** YYYY-MM-DD HH:mm:ss */
  measuredAt: string;
  /** TIME_SLOTS.code（含 RANDOM） */
  mealContext: string;
  /** `DETECT` 或 '3'~'9' */
  resultType: string;
  /** mmol/L；仅「检测」时有值 */
  valueMmolL?: number | null;
  /** 试纸数量（整数 0~999）；仅「检测」时可填 */
  testStrip?: number | null;
  operatorId: string;
  remark?: string | null;
}

/** 添加血糖（住院患者） */
export function createGlucose(
  patientId: string,
  payload: CreateGlucosePayload,
): Promise<GlucoseCreateResult> {
  return http.post<GlucoseCreateResult>(`/patients/${patientId}/glucose`, payload);
}

/**
 * 血糖报告查询参数（前端以字符串/数字传递，后端用共享 schema 校验）。
 *
 * R24（裁定 Q16）：原天粒度 `startDate/endDate` 升级为**秒粒度** `startTime/endTime`
 * （本地时间 `YYYY-MM-DD HH:mm:ss`，闭区间），由查询表单按住院/科室记录联动推导。
 */
export interface GlucoseReportParams {
  [key: string]: string | number | undefined;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime?: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime?: string;
  page?: number;
  /** 每页**日期数**（不是血糖记录条数），默认 15 */
  pageSize?: number;
}

/**
 * 血糖报告：日期 × 时段矩阵（只读）。
 * 属敏感查询，后端每次调用写一条 GLUCOSE_REPORT_VIEW 审计（含越权 DENIED）。
 */
export function fetchGlucoseReport(
  patientId: string,
  params: GlucoseReportParams = {},
): Promise<GlucoseReportResponse> {
  return http.get<GlucoseReportResponse>(`/patients/${patientId}/glucose/report`, params);
}

/**
 * R27：血糖记录列表查询参数（前端以字符串/数字传递，后端用共享 schema 校验）。
 * 时间口径与报表一致：秒粒度本地时间 `YYYY-MM-DD HH:mm:ss` 闭区间，单侧不传则该侧不限。
 */
export interface GlucoseRecordParams {
  [key: string]: string | number | undefined;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime?: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime?: string;
  page?: number;
  /** 每页**记录条数**（不是日期数），固定 15（GLUCOSE_RECORD_PAGE_SIZE），无条数切换器 */
  pageSize?: number;
}

/**
 * R27：血糖记录列表（平铺分页 + 统计栏，统计口径与报表一致——裁定 Q8）。
 * 属敏感查询，后端每次调用写一条 GLUCOSE_RECORD_QUERY 审计（含越权 DENIED）。
 */
export function fetchGlucoseRecords(
  patientId: string,
  params: GlucoseRecordParams = {},
): Promise<GlucoseRecordListResponse> {
  return http.get<GlucoseRecordListResponse>(`/patients/${patientId}/glucose/records`, params);
}

/**
 * R25：单条血糖详情（review/编辑弹框回填）。
 * 后端不单独审计（报表查询已留痕）；记录不存在/已作废 → 41001（拦截器 toast，调用方刷新报表）。
 */
export function fetchGlucoseDetail(
  patientId: string,
  recordId: string,
): Promise<GlucoseRecordDetail> {
  return http.get<GlucoseRecordDetail>(`/patients/${patientId}/glucose/${recordId}`);
}

/**
 * R25：编辑血糖。请求体与添加完全一致（复用 createGlucoseSchema 口径）。
 * 编辑撞检测时间 → 41003（字段级挂 measuredAt）；并发冲突 → 10008。
 */
export function updateGlucose(
  patientId: string,
  recordId: string,
  payload: CreateGlucosePayload,
): Promise<GlucoseUpdateResult> {
  return http.patch<GlucoseUpdateResult>(`/patients/${patientId}/glucose/${recordId}`, payload);
}

/**
 * R25：作废血糖（软删除）。HTTP DELETE，但后端只置 voidedAt/voidedById，不物理删行。
 * 需要 glucose:delete 权限（仅护士长/系统管理员）；重复作废 → 10008。
 */
export function voidGlucose(patientId: string, recordId: string): Promise<GlucoseVoidResult> {
  return http.delete<GlucoseVoidResult>(`/patients/${patientId}/glucose/${recordId}`);
}
