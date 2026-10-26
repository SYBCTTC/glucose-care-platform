import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuditAction } from '@prisma/client';
import type { Request } from 'express';
import { catchError, from, map, mergeMap, Observable, throwError } from 'rxjs';
import { AUDIT_ACTION_KEY, AUDIT_DETAIL_ALLOW_LIST } from '../decorators/audit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditResult, AuthenticatedUser } from '../types';

interface AuditableRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * 审计日志拦截器。
 * 规则：
 *  1. 只处理标注了 @Audit(...) 的接口
 *  2. 只写白名单字段，禁止把患者身份信息写进 detail
 *  3. 审计写入失败不得影响业务结果，但必须打错误日志
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuditableRequest>();

    return next.handle().pipe(
      mergeMap((data) =>
        from(this.write(action as AuditAction, request, context, 'SUCCESS', data)).pipe(
          map(() => data),
        ),
      ),
      catchError((error: unknown) =>
        from(
          this.write(
            action as AuditAction,
            request,
            context,
            error instanceof ForbiddenException ? 'DENIED' : 'FAILED',
            null,
            error,
          ),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async write(
    action: AuditAction,
    request: AuditableRequest,
    context: ExecutionContext,
    result: AuditResult,
    payload: unknown,
    error?: unknown,
  ): Promise<void> {
    try {
      const user = request.user;
      const params = (request.params ?? {}) as Record<string, unknown>;
      const query = (request.query ?? {}) as Record<string, unknown>;
      const body = (request.body ?? {}) as Record<string, unknown>;

      await this.prisma.auditLog.create({
        data: {
          operatorId: user?.userId,
          operatorName: user?.displayName,
          departmentId: user?.departmentId,
          action,
          targetType: typeof params.id === 'string' ? 'PATIENT' : undefined,
          targetId: typeof params.id === 'string' ? params.id : undefined,
          targetKey: typeof body.username === 'string' ? body.username : undefined,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          result,
          detail: {
            ...pickAllowedFields({ ...params, ...query, ...body }),
            ...pickPayloadFields(payload),
            ...(error ? { error: 'denied_or_failed' } : {}),
            path: `${request.method} ${request.route?.path ?? request.url}`,
            requestId: context.getClass().name,
          },
        },
      });
    } catch (writeError) {
      // 审计写失败必须暴露出来，交由监控处理，但不可中断业务
      console.error('[audit] 审计日志写入失败', action, writeError);
    }
  }
}

/**
 * 从响应体里取白名单字段。
 * 业务字段在统一响应信封 { code, message, data } 的 data 里（如 changedFields），
 * 信封本身也要看一层，避免漏掉将来提到顶层的字段。
 */
function pickPayloadFields(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') {
    return {};
  }
  const envelope = payload as Record<string, unknown>;
  const nested = envelope.data;
  return {
    ...(nested !== null && typeof nested === 'object'
      ? pickAllowedFields(nested as Record<string, unknown>)
      : {}),
    ...pickAllowedFields(envelope),
  };
}

function pickAllowedFields(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of AUDIT_DETAIL_ALLOW_LIST) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}