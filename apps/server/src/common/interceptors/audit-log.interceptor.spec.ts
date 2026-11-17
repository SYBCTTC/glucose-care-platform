import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { AuditLogInterceptor } from './audit-log.interceptor';

/**
 * 审计拦截器 detail 白名单行为。
 * 重点回归：血糖重复提交被幂等跳过时，接口仍返回成功，
 * 审计必须靠 detail.skipped 才能区分"写入了"和"未重复保存"。
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

describe('AuditLogInterceptor — detail 白名单', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: ReturnType<typeof createInterceptor>['prisma'];

  beforeEach(() => {
    ({ interceptor, prisma } = createInterceptor('GLUCOSE_CREATE'));
  });

  async function run(payload: unknown, request = glucoseRequest()) {
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
});
