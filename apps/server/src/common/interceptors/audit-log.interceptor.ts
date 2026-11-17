import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuditAction } from '@prisma/client';
import type { Request } from 'express';
import { catchError, from, map, mergeMap, Observable, throwError } from 'rxjs';
import type { AuditMeta, AuditOptions } from '../decorators/audit.decorator';
import { AUDIT_DETAIL_ALLOW_LIST, AUDIT_META_KEY } from '../decorators/audit.decorator';
import { BusinessException } from '../exceptions/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditResult, AuthenticatedUser } from '../types';

interface AuditableRequest extends Request {
  user?: AuthenticatedUser;
  /** 由 RequestIdMiddleware 生成，与响应头 X-Request-Id 同值，用于串联审计行与服务端日志 */
  requestId?: string;
}

/** 3xxxx 号段 = 授权与数据权限（docs/ERROR-CODES.md §D3、error-codes 规则第 7 条） */
const AUTHORIZATION_CODE_MIN = 30000;
const AUTHORIZATION_CODE_MAX = 40000;

/**
 * 取异常携带的业务错误码；取不到返回 null。
 *
 * 只认数字码：Prisma 的 `PrismaClientKnownRequestError.code` 是 'P2002' 这类字符串，
 * 不能被误当成业务码写进审计。
 */
function extractErrorCode(error: unknown): number | null {
  if (error instanceof BusinessException) {
    return error.code;
  }
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number') {
      return code;
    }
  }
  return null;
}

/**
 * 判定审计结果三值。
 *
 * 为什么按码段判而不是按异常类型判：项目规范（error-codes 规则第 1 条）要求业务错误一律抛
 * `BusinessException`，全仓没有任何守卫或 service 抛 `ForbiddenException`，
 * 因此原先的 `error instanceof ForbiddenException` 分支实际不可达，越权事件全被记成 FAILED，
 * 导致审计表无法筛出越权尝试（等保三级要求越权留痕）。
 * `ForbiddenException` 分支保留作框架层兜底。
 */
function resolveAuditResult(error: unknown): AuditResult {
  const code = extractErrorCode(error);
  if (code !== null && code >= AUTHORIZATION_CODE_MIN && code < AUTHORIZATION_CODE_MAX) {
    return 'DENIED';
  }
  return error instanceof ForbiddenException ? 'DENIED' : 'FAILED';
}

/**
 * 按点号路径从响应体取值，用于 `@Audit(action, { targetIdFrom: 'data.id' })`。
 *
 * 手写遍历，**不用 `eval` / `new Function`**（路径来自代码里的字面量，但仍避免动态求值）。
 * 只接受非空字符串：targetId 是主键，取到数字/对象/空串一律视为"没取到"，
 * 这样路径写错时表现为审计字段留空（可发现），而不是写进一个错误的值（难发现）。
 */
function resolvePath(source: unknown, path: string): string | undefined {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

/**
 * 审计日志拦截器。
 * 规则：
 *  1. 只处理标注了 @Audit(...) 的接口
 *  2. 只写白名单字段，禁止把患者身份信息写进 detail
 *  3. 审计写入失败不得影响业务结果，但必须打错误日志
 *  4. 越权（3xxxx）记 DENIED，其余异常记 FAILED；失败时 detail 带 errorCode 便于按码统计安全事件
 *  5. targetId 优先取 URL `params.id`；创建类接口无 `:id`，改按 `targetIdFrom` 从响应信封取
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_META_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta?.action) {
      return next.handle();
    }
    const { action, ...options } = meta;

    const http = context.switchToHttp();
    const request = http.getRequest<AuditableRequest>();

    return next.handle().pipe(
      mergeMap((data) =>
        from(this.write(action as AuditAction, request, 'SUCCESS', data, options)).pipe(
          map(() => data),
        ),
      ),
      catchError((error: unknown) =>
        from(
          this.write(action as AuditAction, request, resolveAuditResult(error), null, options, error),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async write(
    action: AuditAction,
    request: AuditableRequest,
    result: AuditResult,
    payload: unknown,
    options: AuditOptions,
    error?: unknown,
  ): Promise<void> {
    try {
      const user = request.user;
      const params = (request.params ?? {}) as Record<string, unknown>;
      const query = (request.query ?? {}) as Record<string, unknown>;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const errorCode = error === undefined ? null : extractErrorCode(error);

      // URL 有 :id 时以它为准（更新/详情/血糖录入）；创建类接口无 :id，
      // 退回按 targetIdFrom 从响应信封取新对象 ID。失败路径 payload 为 null，自然取不到。
      const targetId =
        (typeof params.id === 'string' ? params.id : undefined) ??
        (options.targetIdFrom ? resolvePath(payload, options.targetIdFrom) : undefined);
      // 未显式声明 targetType 时沿用旧行为（有 ID 即视为患者），保持存量审计口径不变
      const targetType = options.targetType ?? (targetId === undefined ? undefined : 'PATIENT');

      await this.prisma.auditLog.create({
        data: {
          operatorId: user?.userId,
          operatorName: user?.displayName,
          departmentId: user?.departmentId,
          action,
          targetType,
          targetId,
          targetKey: typeof body.username === 'string' ? body.username : undefined,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          result,
          detail: {
            ...pickAllowedFields({ ...params, ...query, ...body }),
            ...pickPayloadFields(payload),
            ...(error ? { error: 'denied_or_failed' } : {}),
            // 业务错误码：便于按码统计安全事件（如筛出全部 30002 越权尝试）。
            // 取不到码时不写该键，避免 null 混进 JSON 影响查询。
            ...(errorCode === null ? {} : { errorCode }),
            path: `${request.method} ${request.route?.path ?? request.url}`,
            // 与响应头 X-Request-Id 同值，据此可串联审计行、服务端日志与用户报障。
            // 原实现误存 context.getClass().name（如 'AuthController'），无法关联，已修正。
            requestId: request.requestId ?? '',
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