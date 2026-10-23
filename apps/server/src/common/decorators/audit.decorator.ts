import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit:action';

/**
 * 标记需要写审计日志的接口。等保三级要求覆盖敏感操作，
 * 因此每个涉及患者数据的接口都必须标注 @Audit(...)。
 */
export const Audit = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);

/** 允许写入 detail 的字段白名单，其余字段一律丢弃（防止把患者敏感数据写进日志） */
export const AUDIT_DETAIL_ALLOW_LIST = [
  'patientId',
  'deviceId',
  'deviceSn',
  'measuredAt',
  'mealContext',
  'valueMmolL',
  'count',
  'rangeFrom',
  'rangeTo',
] as const;