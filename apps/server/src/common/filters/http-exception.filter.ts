import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ERROR_CODES, errorMeta, formatDateTime } from '@gc/shared';
import type { ErrorCode, FieldError } from '@gc/shared';
import type { Request, Response } from 'express';

/**
 * 统一响应结构：{ code, message, data, details?, requestId, timestamp }
 *  - code 为业务错误码（docs/ERROR-CODES.md），不再等于 HTTP 状态码
 *  - 5xx 一律屏蔽真实原因，只返回规范文案 + requestId，禁止泄漏堆栈/SQL
 *  - 日志中不得输出患者姓名、证件号等敏感明文
 */

/** 非 BusinessException 抛出的 Nest 内置异常 → 兜底业务码 */
const HTTP_STATUS_FALLBACK: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.INVALID_PARAM,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.SESSION_EXPIRED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.RESOURCE_NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ERROR_CODES.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONCURRENT_CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.GATEWAY_TIMEOUT]: ERROR_CODES.REQUEST_TIMEOUT,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_ERROR,
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let code: ErrorCode = HTTP_STATUS_FALLBACK[status] ?? ERROR_CODES.INTERNAL_ERROR;
    let message = errorMeta(code).message;
    let details: FieldError[] | undefined;

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const obj = payload as { code?: ErrorCode; message?: string | string[]; details?: FieldError[] };
        if (typeof obj.code === 'number') {
          code = obj.code;
        }
        message = Array.isArray(obj.message)
          ? obj.message.join('; ')
          : (obj.message ?? errorMeta(code).message);
        details = obj.details;
      }
    } else if (exception instanceof Error) {
      // 未捕获异常：记录堆栈，但对外只暴露规范文案
      this.logger.error(exception.message, exception.stack);
    }

    // 5xx 记录路径、状态码与 requestId；4xx 不打印堆栈，避免刷屏
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} code=${code} requestId=${request.requestId ?? '-'} ${message}`,
      );
      // 屏蔽真实原因，防止泄漏实现细节
      message = errorMeta(code).message;
    }

    response.status(status).json({
      code,
      message,
      data: null,
      ...(details?.length ? { details } : {}),
      requestId: request.requestId ?? '',
      timestamp: formatDateTime(new Date()) ?? '',
    });
  }
}
