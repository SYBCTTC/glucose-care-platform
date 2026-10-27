import type { GlucoseCreateResult } from '@gc/shared';
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
