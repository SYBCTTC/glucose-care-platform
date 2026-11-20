import type { GlucoseCreateResult, GlucoseReportResponse } from '@gc/shared';
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
