import { SetMetadata } from '@nestjs/common';

/**
 * `@Audit` 写入的元数据。
 *
 * 用**单个** key 存整个对象，而不是 action / options 分两个 key：
 * `SetMetadata` 的返回类型带 `KEY` 属性，组合两个装饰器需要类型断言，不如一次存全。
 */
export const AUDIT_META_KEY = 'audit:meta';

/**
 * `@Audit` 的可选参数。
 *
 * 为什么需要 `targetIdFrom`：拦截器原先只从 URL `params.id` 取审计对象 ID，
 * 而 `POST /patients` 这类创建接口路径里没有 `:id`，新对象 ID 只存在于**响应体**中，
 * 导致建档审计的 `targetType` / `targetId` 恒为空，事后无法按患者追溯建档操作。
 */
export interface AuditOptions {
  /**
   * 审计对象类型（如 `PATIENT`）。
   * 不传则沿用旧行为：能取到 targetId 时记 `PATIENT`，取不到则为空。
   * 新增非患者对象的审计时**必须显式传**，否则会被误记成 `PATIENT`。
   */
  targetType?: string;
  /**
   * 从响应体按**点号路径**取 targetId，用于 URL 无 `:id` 的创建类接口。
   * 路径相对于统一响应信封 `{ code, message, data }`，如 `data.id`。
   * 只在成功路径生效（失败时本就没有新对象）；取不到或非字符串则留空，不报错。
   */
  targetIdFrom?: string;
}

/** `@Audit` 实际写入反射的元数据形状 */
export interface AuditMeta extends AuditOptions {
  action: string;
}

/**
 * 标记需要写审计日志的接口。等保三级要求覆盖敏感操作，
 * 因此每个涉及患者数据的接口都必须标注 @Audit(...)。
 */
export const Audit = (action: string, options?: AuditOptions) =>
  SetMetadata(AUDIT_META_KEY, { action, ...options } satisfies AuditMeta);

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
  /**
   * 虚拟病区进出记录 ID（UUID，不含患者身份信息）：加入/移出虚拟病区留痕。
   * 同一患者可多次进出（每次新建记录），只靠 targetId + action 无法定位是哪一次，
   * 故记下记录 ID。审计对象仍是患者（targetType='PATIENT'、targetId=患者 ID）。
   */
  'wardRecordId',
  /** 虚拟病区移出方式，枚举码 MANUAL / DISCHARGE / ARCHIVE，不含患者信息 */
  'leaveReason',
] as const;
