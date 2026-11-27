import type { GlucoseAlertListResponse } from '@gc/shared';
import { http } from './client';

/**
 * 预警列表查询参数（P4-7，GET /glucose/alerts）。
 * 值统一 String() 序列化（http.get 约定），后端按共享 glucoseAlertQuerySchema 校验：
 * - startTime/endTime：'YYYY-MM-DD HH:mm:ss' 本地秒级（前端恒送，预设口径见 alert-time.ts）；
 * - valueGt/valueLt：正数、至多 1 位小数（InputNumber 数值原样送，序列化后仍满足正则）。
 */
export interface GlucoseAlertListParams {
  [key: string]: string | number | undefined;
  /** 缺省 = 所有预警（high/low 对应 Tab） */
  type?: string;
  departmentId?: string;
  doctorId?: string;
  patientNo?: string;
  name?: string;
  bedNo?: string;
  admissionStatus?: string;
  startTime: string;
  endTime: string;
  valueGt?: number;
  valueLt?: number;
  page?: number;
  pageSize?: number;
}

/**
 * 跨患者血糖预警列表（住院管理-预警管理，P4-7）。
 * 敏感查询：后端每次调用写一条 GLUCOSE_ALERT_QUERY 审计，禁止轮询。
 */
export function fetchGlucoseAlerts(
  params: GlucoseAlertListParams,
): Promise<GlucoseAlertListResponse> {
  return http.get<GlucoseAlertListResponse>('/glucose/alerts', params);
}
