import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { formatDateTime } from '@gc/shared';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';

/**
 * 成功响应补充 requestId 与 timestamp（错误响应由 HttpExceptionFilter 补充）。
 * 仅处理已经包装成 { code, message, data } 的响应，避免影响健康检查等裸响应。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    return next.handle().pipe(
      map((payload: unknown) => {
        if (payload && typeof payload === 'object' && 'code' in (payload as Record<string, unknown>)) {
          return {
            ...(payload as Record<string, unknown>),
            requestId: request.requestId ?? '',
            timestamp: formatDateTime(new Date()) ?? '',
          };
        }
        return payload;
      }),
    );
  }
}
