import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessException } from '../exceptions/business.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditLogInterceptor } from './audit-log.interceptor';

/**
 * 审计拦截器行为。
 * 重点回归一：血糖重复提交被幂等跳过时，接口仍返回成功，
 *   审计必须靠 detail.skipped 才能区分"写入了"和"未重复保存"。
 * 重点回归二：越权（3xxxx）必须记 DENIED 而非 FAILED，否则审计表筛不出越权尝试
 *   （等保三级要求越权留痕）。此前按 `instanceof ForbiddenException` 判定，
 *   而全仓业务错误一律抛 BusinessException，该分支实际不可达。
 * 重点回归三：detail.requestId 必须是 RequestIdMiddleware 生成的 UUID，
 *   此前误存控制器类名，无法与服务端日志、用户报障关联。
 */

const user = {
  userId: 'u-nurse',
  displayName: '李护士',
  departmentId: 'd-endo',
} as never;

/** 添加血糖的请求（含自由文本备注与患者身份信息，均不得入 detail） */
function glucoseRequest() {
  return {
    user,
    ip: '10.0.0.8',
    headers: { 'user-agent': 'vitest' },
    method: 'POST',
    // RequestIdMiddleware 写入的请求编号，审计 detail.requestId 必须取这个值
    requestId: 'b7f3c1d2-4e5a-4f6b-8c9d-0e1f2a3b4c5d',
    route: { path: '/patients/:id/glucose' },
    params: { id: 'p-1' },
    query: {},
    body: {
      measuredAt: new Date('2026-10-27T02:30:00.000Z'),
      mealContext: 'FASTING',
      resultType: 'DETECT',
      valueMmolL: 8.9,
      testStrip: 2,
      operatorId: 'u-nurse',
      remark: '患者自述昨晚进食偏多',
    },
  };
}

/** ResponseInterceptor 之后、审计拦截器实际看到的响应信封 */
function glucoseEnvelope(skipped: boolean) {
  return {
    code: 0,
    message: '操作成功',
    requestId: 'req-1',
    timestamp: '2026-10-27 10:30:00',
    data: {
      id: 'g-1',
      skipped,
      resultType: '1',
      valueMmolL: 8.9,
      measuredAt: '2026-10-27 10:30:00',
      // 列表项含脱敏身份信息，属白名单外，必须被丢弃
      item: { id: 'p-1', nameMasked: '张**', phoneMasked: '138****1234' },
    },
  };
}

function createContext(request: unknown): ExecutionContext {
  return {
    getHandler: () => 'create',
    getClass: () => class GlucoseController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createInterceptor(action: string | undefined) {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(action),
  } as unknown as Reflector;
  const prisma = { auditLog: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) } };
  const interceptor = new AuditLogInterceptor(reflector, prisma as unknown as PrismaService);
  return { interceptor, prisma };
}

function handlerOf(payload: unknown): CallHandler {
  return { handle: () => of(payload) };
}

/** 业务抛错的 handler，用于验证失败路径的审计落库 */
function failingHandler(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) };
}

describe('AuditLogInterceptor — detail 白名单', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: ReturnType<typeof createInterceptor>['prisma'];

  beforeEach(() => {
    ({ interceptor, prisma } = createInterceptor('GLUCOSE_CREATE'));
  });

  async function run(payload: unknown, request: Record<string, unknown> = glucoseRequest()) {
    await firstValueFrom(interceptor.intercept(createContext(request), handlerOf(payload)));
    return prisma.auditLog.create.mock.calls[0][0].data;
  }

  it('幂等跳过时 detail 记 skipped=true，result 仍为 SUCCESS', async () => {
    const written = await run(glucoseEnvelope(true));

    expect(written.action).toBe('GLUCOSE_CREATE');
    expect(written.result).toBe('SUCCESS');
    expect(written.detail.skipped).toBe(true);
    // 业务字段照常留痕，便于事后定位是哪一次提交被跳过
    expect(written.detail.mealContext).toBe('FASTING');
    expect(written.detail.resultType).toBe('1');
    expect(written.detail.testStrip).toBe(2);
    expect(written.targetType).toBe('PATIENT');
    expect(written.targetId).toBe('p-1');
  });

  it('正常写入时 detail 记 skipped=false，与跳过可区分', async () => {
    const written = await run(glucoseEnvelope(false));

    expect(written.result).toBe('SUCCESS');
    expect(written.detail.skipped).toBe(false);
  });

  it('白名单外字段一律丢弃：患者身份信息、自由文本备注不入 detail', async () => {
    const written = await run(glucoseEnvelope(true));

    expect(written.detail.item).toBeUndefined();
    expect(written.detail.nameMasked).toBeUndefined();
    expect(written.detail.phoneMasked).toBeUndefined();
    expect(written.detail.remark).toBeUndefined();
    expect(written.detail.operatorId).toBeUndefined();
  });

  it('未标注 @Audit 的接口不写审计', async () => {
    const { interceptor: plain, prisma: plainPrisma } = createInterceptor(undefined);

    await firstValueFrom(
      plain.intercept(createContext(glucoseRequest()), handlerOf(glucoseEnvelope(true))),
    );

    expect(plainPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('detail.requestId 取请求上的 UUID，不是控制器类名', async () => {
    const written = await run(glucoseEnvelope(false));

    expect(written.detail.requestId).toBe('b7f3c1d2-4e5a-4f6b-8c9d-0e1f2a3b4c5d');
    expect(written.detail.requestId).not.toBe('GlucoseController');
  });

  it('请求上没有 requestId 时写空串，不落 undefined', async () => {
    const request = glucoseRequest() as Record<string, unknown>;
    delete request.requestId;

    const written = await run(glucoseEnvelope(false), request);

    expect(written.detail.requestId).toBe('');
  });
});

describe('AuditLogInterceptor — 失败路径的 result 与 errorCode', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: ReturnType<typeof createInterceptor>['prisma'];

  beforeEach(() => {
    ({ interceptor, prisma } = createInterceptor('GLUCOSE_CREATE'));
  });

  /** 跑一次失败请求：既要落审计，也要把原异常原样抛出（不得吞掉业务错误） */
  async function runFailure(error: unknown, request: Record<string, unknown> = glucoseRequest()) {
    await expect(
      firstValueFrom(interceptor.intercept(createContext(request), failingHandler(error))),
    ).rejects.toBe(error);
    return prisma.auditLog.create.mock.calls[0][0].data;
  }

  it.each([
    ['跨科室越权 30002', ERROR_CODES.CROSS_DEPARTMENT_DENIED],
    ['缺少权限点 30004', ERROR_CODES.MISSING_PERMISSION],
    ['角色无患者数据权限 30006', ERROR_CODES.NO_PATIENT_DATA_SCOPE],
    ['患者已归档 30003', ERROR_CODES.PATIENT_ARCHIVED],
  ])('%s → result=DENIED 且 detail.errorCode 落码', async (_label, code) => {
    const written = await runFailure(new BusinessException(code));

    expect(written.result).toBe('DENIED');
    expect(written.detail.errorCode).toBe(code);
  });

  it.each([
    ['参数校验失败 10001', ERROR_CODES.VALIDATION_FAILED],
    ['患者不存在 40001', ERROR_CODES.PATIENT_NOT_FOUND],
    ['患者状态不允许 40004', ERROR_CODES.PATIENT_INVALID_STATE],
    ['会话失效 20002', ERROR_CODES.SESSION_EXPIRED],
  ])('%s → result=FAILED（非授权类不得混入 DENIED）', async (_label, code) => {
    const written = await runFailure(new BusinessException(code));

    expect(written.result).toBe('FAILED');
    expect(written.detail.errorCode).toBe(code);
  });

  it('3xxxx 边界：29999 与 40000 都不算越权', async () => {
    // 边界码不在码表里，仅为验证号段判断的开区间，故用 as never 绕过 ErrorCode 字面量约束
    const below = await runFailure(new BusinessException(29999 as never));
    expect(below.result).toBe('FAILED');

    prisma.auditLog.create.mockClear();
    const above = await runFailure(new BusinessException(40000 as never));
    expect(above.result).toBe('FAILED');
  });

  it('框架层 ForbiddenException 仍记 DENIED（兜底分支保留）', async () => {
    const written = await runFailure(new ForbiddenException('no access'));

    expect(written.result).toBe('DENIED');
    // 非 BusinessException 取不到业务码，不写 errorCode 键
    expect('errorCode' in written.detail).toBe(false);
  });

  it('普通 Error 记 FAILED，且不写 errorCode', async () => {
    const written = await runFailure(new Error('boom'));

    expect(written.result).toBe('FAILED');
    expect('errorCode' in written.detail).toBe(false);
    expect(written.detail.error).toBe('denied_or_failed');
  });

  it('Prisma 错误的字符串 code（P2002）不得被当成业务码', async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

    const written = await runFailure(prismaError);

    expect(written.result).toBe('FAILED');
    expect('errorCode' in written.detail).toBe(false);
  });

  it('失败时仍写白名单业务字段与 targetId，便于定位是哪次越权', async () => {
    const written = await runFailure(new BusinessException(ERROR_CODES.CROSS_DEPARTMENT_DENIED));

    expect(written.targetType).toBe('PATIENT');
    expect(written.targetId).toBe('p-1');
    expect(written.detail.mealContext).toBe('FASTING');
    // 身份信息与自由文本仍不得入 detail
    expect(written.detail.remark).toBeUndefined();
    expect(written.detail.item).toBeUndefined();
  });
});
