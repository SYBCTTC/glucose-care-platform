import { HttpException } from '@nestjs/common';
import { errorMeta } from '@gc/shared';
import type { ErrorCode, FieldError } from '@gc/shared';

/**
 * 业务异常：统一携带业务错误码（docs/ERROR-CODES.md）。
 *
 * 用法：
 *   throw new BusinessException(ERROR_CODES.CROSS_DEPARTMENT_DENIED);
 *   throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
 *
 * 说明：message 省略时取 ERROR_CODE_META 的默认中文文案（服务端权威文案）。
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, details?: FieldError[]) {
    const meta = errorMeta(code);
    super({ code, message: message ?? meta.message, details }, meta.httpStatus);
    this.code = code;
  }
}
