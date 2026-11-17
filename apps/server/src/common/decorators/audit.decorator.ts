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
  /** 血糖添加：结果类型与试纸数量（备注为自由文本，可能含个人信息，不入日志） */
  'resultType',
  'testStrip',
  /**
   * 血糖添加：本次是否因唯一约束 (patientId, measuredAt) 命中而幂等跳过。
   * 跳过时接口仍返回成功（result = SUCCESS），但库里没有新数据，
   * 因此必须把 skipped 落进 detail，否则事后无法区分"写入了"和"未重复保存"。
   * 布尔值，不含患者身份信息。
   */
  'skipped',
  'count',
  'rangeFrom',
  'rangeTo',
  /** 变更字段名数组（只记字段名，不记值）：患者编辑等需要追溯"改了哪些字段"的场景 */
  'changedFields',
  /** 状态流转前后值（仅状态码，不含患者信息）：办理住院等流转类操作留痕 */
  'fromStatus',
  'toStatus',
] as const;
