import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * 为每个请求生成 requestId：
 *  - 写入 req.requestId（异常过滤器、审计拦截器使用）
 *  - 写入响应头 X-Request-Id（便于抓包与前端埋点）
 * 作用：等保要求的"可追溯"，5xx 时前端把该编号展示给用户报修。
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    (req as Request & { requestId?: string }).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
