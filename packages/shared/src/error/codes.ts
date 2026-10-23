/**
 * 服务端错误码规范：docs/ERROR-CODES.md
 *
 * 约定：
 *  1. `code` 是独立业务码，HTTP 状态码仍保持语义正确（REST + 等保要求）
 *  2. message 为可直接展示的简体中文，禁止暴露堆栈/SQL/设备 SN
 *  3. 前后端共用同一份码表，前端请求拦截器按 ERROR_CODE_META.action 分派处理
 *  4. 新增错误码必须先登记到 docs/ERROR-CODES.md，再改本文件
 */

export const ERROR_CODES = {
  /** 成功 */
  SUCCESS: 0,

  // ---------- 1xxxx 通用错误 ----------
  INTERNAL_ERROR: 10000,
  VALIDATION_FAILED: 10001,
  MISSING_PARAM: 10002,
  INVALID_PARAM: 10003,
  MALFORMED_BODY: 10004,
  RESOURCE_NOT_FOUND: 10005,
  INVALID_PAGINATION: 10006,
  REQUEST_TIMEOUT: 10007,
  CONCURRENT_CONFLICT: 10008,
  UNSUPPORTED_FILE_FORMAT: 10009,
  METHOD_NOT_ALLOWED: 10010,
  MAINTENANCE: 10011,
  RATE_LIMITED: 10012,

  // ---------- 2xxxx 认证与会话 ----------
  INVALID_CREDENTIALS: 20001,
  SESSION_EXPIRED: 20002,
  ACCOUNT_LOCKED: 20003,
  ACCOUNT_DISABLED: 20004,
  PASSWORD_CHANGE_REQUIRED: 20005,
  WEAK_PASSWORD: 20006,
  WRONG_CURRENT_PASSWORD: 20007,
  SESSION_KICKED: 20008,
  /** 新密码与当前密码相同（等保：口令更换不得复用） */
  PASSWORD_REUSE: 20009,

  // ---------- 3xxxx 授权与数据权限（全部记审计） ----------
  FORBIDDEN: 30001,
  CROSS_DEPARTMENT_DENIED: 30002,
  PATIENT_ARCHIVED: 30003,
  MISSING_PERMISSION: 30004,
  DEVICE_PATIENT_MISMATCH: 30005,
  /** 角色本身无患者数据权限（如设备管理员），与"跨科室越权"区分，便于审计分类 */
  NO_PATIENT_DATA_SCOPE: 30006,

  // ---------- 4xxxx 患者 ----------
  PATIENT_NOT_FOUND: 40001,
  PATIENT_NO_DUPLICATE: 40002,
  PATIENT_ALREADY_BOUND: 40003,
  PATIENT_INVALID_STATE: 40004,

  // ---------- 42xxx 设备 ----------
  DEVICE_NOT_FOUND: 42001,
  DEVICE_SN_DUPLICATE: 42002,
  DEVICE_BOUND_TO_OTHER: 42003,
  DEVICE_INVALID_STATE: 42004,
  DEVICE_CALIBRATION_EXPIRED: 42005,
  DEVICE_NOT_BOUND: 42006,
  VENDOR_CALL_FAILED: 42007,
  VENDOR_DATA_INVALID: 42008,

  // ---------- 43xxx 用户与角色 ----------
  USER_NOT_FOUND: 43001,
  USERNAME_DUPLICATE: 43002,
  LAST_ADMIN_PROTECTED: 43003,
  CANNOT_MODIFY_SELF_ROLE: 43004,

  // ---------- 5xxxx 系统与依赖 ----------
  DB_UNAVAILABLE: 50001,
  DB_WRITE_CONFLICT: 50002,
  DEPENDENCY_UNAVAILABLE: 50003,
  AUDIT_WRITE_FAILED: 50004,
  DATA_PROCESS_FAILED: 50005,

  // ---------- 9xxxx 厂商接入（预留） ----------
  VENDOR_AUTH_FAILED: 90001,
  VENDOR_TIMEOUT: 90002,
  VENDOR_PAYLOAD_INVALID: 90003,
} as const;

export type ErrorCodeName = keyof typeof ERROR_CODES;
export type ErrorCode = (typeof ERROR_CODES)[ErrorCodeName];

/**
 * 前端处理策略（请求拦截器按此分派，见 docs/ERROR-CODES.md E 节）：
 * - field：映射到表单字段，不弹全局 toast
 * - toast：轻提示
 * - toast-refresh：提示 + 刷新列表
 * - relogin：清 token + 跳登录（并发请求去重）
 * - lock：锁定/限流，展示倒计时并禁用提交
 * - warn：请求成功但需黄色警示（如待复核）
 * - fatal：系统故障兜底文案 + 展示 requestId
 */
export type ErrorAction =
  | 'none'
  | 'field'
  | 'toast'
  | 'toast-refresh'
  | 'relogin'
  | 'lock'
  | 'warn'
  | 'fatal';

export interface ErrorCodeMeta {
  httpStatus: number;
  message: string;
  action: ErrorAction;
}

export const ERROR_CODE_META: Record<ErrorCode, ErrorCodeMeta> = {
  [ERROR_CODES.SUCCESS]: { httpStatus: 200, message: 'success', action: 'none' },

  // ---------- 1xxxx ----------
  [ERROR_CODES.INTERNAL_ERROR]: { httpStatus: 500, message: '服务器内部错误', action: 'fatal' },
  [ERROR_CODES.VALIDATION_FAILED]: { httpStatus: 422, message: '参数校验失败', action: 'field' },
  [ERROR_CODES.MISSING_PARAM]: { httpStatus: 400, message: '缺少必填参数', action: 'toast' },
  [ERROR_CODES.INVALID_PARAM]: { httpStatus: 400, message: '参数格式不正确', action: 'toast' },
  [ERROR_CODES.MALFORMED_BODY]: { httpStatus: 400, message: '请求体格式错误', action: 'toast' },
  [ERROR_CODES.RESOURCE_NOT_FOUND]: { httpStatus: 404, message: '请求的资源不存在', action: 'toast' },
  [ERROR_CODES.INVALID_PAGINATION]: { httpStatus: 400, message: '分页参数不合法', action: 'toast' },
  [ERROR_CODES.REQUEST_TIMEOUT]: { httpStatus: 504, message: '请求超时，请稍后重试', action: 'toast' },
  [ERROR_CODES.CONCURRENT_CONFLICT]: {
    httpStatus: 409,
    message: '数据正在被其他用户修改，请刷新后重试',
    action: 'toast-refresh',
  },
  [ERROR_CODES.UNSUPPORTED_FILE_FORMAT]: { httpStatus: 400, message: '不支持的文件格式', action: 'toast' },
  [ERROR_CODES.METHOD_NOT_ALLOWED]: { httpStatus: 405, message: '请求方法不被支持', action: 'toast' },
  [ERROR_CODES.MAINTENANCE]: { httpStatus: 503, message: '系统维护中，请稍后再试', action: 'fatal' },
  [ERROR_CODES.RATE_LIMITED]: { httpStatus: 429, message: '操作过于频繁，请稍后再试', action: 'lock' },

  // ---------- 2xxxx ----------
  [ERROR_CODES.INVALID_CREDENTIALS]: { httpStatus: 401, message: '用户名或密码错误', action: 'field' },
  [ERROR_CODES.SESSION_EXPIRED]: { httpStatus: 401, message: '登录状态已失效，请重新登录', action: 'relogin' },
  [ERROR_CODES.ACCOUNT_LOCKED]: { httpStatus: 423, message: '密码错误次数过多，账号已锁定', action: 'lock' },
  [ERROR_CODES.ACCOUNT_DISABLED]: { httpStatus: 403, message: '账号已被停用，请联系系统管理员', action: 'toast' },
  [ERROR_CODES.PASSWORD_CHANGE_REQUIRED]: { httpStatus: 403, message: '首次登录请先修改密码', action: 'toast' },
  [ERROR_CODES.WEAK_PASSWORD]: { httpStatus: 422, message: '新密码不符合强度要求', action: 'field' },
  [ERROR_CODES.WRONG_CURRENT_PASSWORD]: { httpStatus: 422, message: '当前密码不正确', action: 'field' },
  [ERROR_CODES.SESSION_KICKED]: { httpStatus: 401, message: '账号已在其他终端登录', action: 'relogin' },
  [ERROR_CODES.PASSWORD_REUSE]: {
    httpStatus: 422,
    message: '新密码不能与当前密码相同',
    action: 'field',
  },

  // ---------- 3xxxx ----------
  [ERROR_CODES.FORBIDDEN]: { httpStatus: 403, message: '当前账号无权访问该资源', action: 'toast' },
  [ERROR_CODES.CROSS_DEPARTMENT_DENIED]: {
    httpStatus: 403,
    message: '无权访问其他科室的患者数据',
    action: 'toast',
  },
  [ERROR_CODES.PATIENT_ARCHIVED]: { httpStatus: 403, message: '该患者已归档，禁止操作', action: 'toast' },
  [ERROR_CODES.MISSING_PERMISSION]: { httpStatus: 403, message: '当前账号缺少所需权限点', action: 'toast' },
  [ERROR_CODES.DEVICE_PATIENT_MISMATCH]: { httpStatus: 403, message: '该设备未绑定此患者', action: 'toast' },
  [ERROR_CODES.NO_PATIENT_DATA_SCOPE]: {
    httpStatus: 403,
    message: '当前角色无权访问患者数据',
    action: 'toast',
  },

  // ---------- 4xxxx 患者 ----------
  [ERROR_CODES.PATIENT_NOT_FOUND]: { httpStatus: 404, message: '患者不存在或已归档', action: 'toast' },
  [ERROR_CODES.PATIENT_NO_DUPLICATE]: { httpStatus: 409, message: '住院号已存在', action: 'toast-refresh' },
  [ERROR_CODES.PATIENT_ALREADY_BOUND]: { httpStatus: 409, message: '该患者已绑定有效设备', action: 'toast-refresh' },
  [ERROR_CODES.PATIENT_INVALID_STATE]: {
    httpStatus: 409,
    message: '患者当前状态不允许该操作',
    action: 'toast-refresh',
  },

  // ---------- 42xxx 设备 ----------
  [ERROR_CODES.DEVICE_NOT_FOUND]: { httpStatus: 404, message: '设备序列号不存在', action: 'toast' },
  [ERROR_CODES.DEVICE_SN_DUPLICATE]: { httpStatus: 409, message: '设备序列号已存在', action: 'toast-refresh' },
  [ERROR_CODES.DEVICE_BOUND_TO_OTHER]: { httpStatus: 409, message: '该设备已绑定其他患者', action: 'toast-refresh' },
  [ERROR_CODES.DEVICE_INVALID_STATE]: { httpStatus: 409, message: '设备当前状态不允许该操作', action: 'toast-refresh' },
  [ERROR_CODES.DEVICE_CALIBRATION_EXPIRED]: {
    httpStatus: 409,
    message: '设备校准已过期，请先校准',
    action: 'toast-refresh',
  },
  [ERROR_CODES.DEVICE_NOT_BOUND]: { httpStatus: 409, message: '该设备未绑定患者', action: 'toast-refresh' },
  [ERROR_CODES.VENDOR_CALL_FAILED]: { httpStatus: 502, message: '设备厂商平台调用失败', action: 'toast' },
  [ERROR_CODES.VENDOR_DATA_INVALID]: { httpStatus: 502, message: '厂商返回数据格式异常', action: 'toast' },

  // ---------- 43xxx 用户与角色 ----------
  [ERROR_CODES.USER_NOT_FOUND]: { httpStatus: 404, message: '用户不存在', action: 'toast' },
  [ERROR_CODES.USERNAME_DUPLICATE]: { httpStatus: 409, message: '用户名已存在', action: 'toast-refresh' },
  [ERROR_CODES.LAST_ADMIN_PROTECTED]: {
    httpStatus: 409,
    message: '不能停用或删除最后一个系统管理员',
    action: 'toast-refresh',
  },
  [ERROR_CODES.CANNOT_MODIFY_SELF_ROLE]: { httpStatus: 409, message: '不能修改自己的角色', action: 'toast-refresh' },

  // ---------- 5xxxx 系统与依赖 ----------
  [ERROR_CODES.DB_UNAVAILABLE]: { httpStatus: 503, message: '数据库服务不可用', action: 'toast' },
  [ERROR_CODES.DB_WRITE_CONFLICT]: { httpStatus: 500, message: '数据写入冲突', action: 'toast-refresh' },
  [ERROR_CODES.DEPENDENCY_UNAVAILABLE]: { httpStatus: 503, message: '依赖服务暂时不可用', action: 'toast' },
  [ERROR_CODES.AUDIT_WRITE_FAILED]: {
    httpStatus: 500,
    message: '操作已提交但日志记录异常',
    action: 'fatal',
  },
  [ERROR_CODES.DATA_PROCESS_FAILED]: { httpStatus: 500, message: '数据处理失败', action: 'fatal' },

  // ---------- 9xxxx 厂商接入（预留） ----------
  [ERROR_CODES.VENDOR_AUTH_FAILED]: { httpStatus: 502, message: '厂商平台认证失败', action: 'toast' },
  [ERROR_CODES.VENDOR_TIMEOUT]: { httpStatus: 504, message: '厂商平台响应超时', action: 'toast' },
  [ERROR_CODES.VENDOR_PAYLOAD_INVALID]: { httpStatus: 422, message: '上报数据不符合接口约定', action: 'toast' },
};

/** 取错误码元信息；未知码按内部错误处理 */
export function errorMeta(code: number): ErrorCodeMeta {
  const meta = (ERROR_CODE_META as Record<number, ErrorCodeMeta>)[code];
  return meta ?? ERROR_CODE_META[ERROR_CODES.INTERNAL_ERROR];
}

/** 是否为成功响应 */
export function isSuccessCode(code: number): boolean {
  return code === ERROR_CODES.SUCCESS;
}

/** 前端是否需要清 token 并跳登录 */
export function shouldRelogin(code: number): boolean {
  return errorMeta(code).action === 'relogin';
}
