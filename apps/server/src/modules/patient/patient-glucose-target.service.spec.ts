import { Logger } from '@nestjs/common';
import { ERROR_CODES, PATIENT_STATUS, PERMISSION, TIME_SLOT_CATEGORY } from '@gc/shared';
import type { UpdatePatientGlucoseTargetsInput } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser } from '../../common/types';
import { PatientGlucoseTargetService } from './patient-glucose-target.service';

/**
 * 患者控糖目标 service 单测。规格 `docs/specs/patient-glucose-target.md` §8 后端项。
 *
 * 任务 ④（判定改造）在本文件覆盖两个阈值解析方法：`resolveResultTypeThreshold`（R4）
 * 与 `resolveAlertThreshold`（R8）。判定结果的比大小逻辑（`resolveResultType`）与
 * R5 重算条件在 `glucose.service.spec.ts` 覆盖 —— 那边把本 service 当桩，
 * 两边各自钉住自己的职责，避免同一断言写两遍。
 */

const PATIENT_ID = 'p-0001';

/** 本科室护士：数据范围 DEPARTMENT，用来验证越权拦截 */
const deptUser = {
  userId: 'u-nurse',
  departmentId: 'd-endo',
  permissions: [PERMISSION.PATIENT_VIEW, PERMISSION.PATIENT_TARGET_UPDATE],
  roles: ['NURSE'],
  dataScope: 'DEPARTMENT',
} as unknown as AuthenticatedUser;

/** 系统管理员：数据范围全院 */
const allUser = { ...deptUser, dataScope: 'ALL' } as unknown as AuthenticatedUser;

/**
 * `TimeSlotService.list()` 的返回形态：阈值已转成 number（不是 Decimal）。
 * 真实库有 13 个时段、展示集合命中 8 个；这里用 3 个普通时段 + 3 个应被排除的时段，
 * 足够覆盖 R1 的过滤条件而不让 fixture 臃肿。
 */
const DISPLAY_SLOTS = [
  { code: 'FASTING', name: '空腹', valueDown: 4.4, valueUp: 7.0, sortOrder: 1 },
  { code: 'LUNCH_POST', name: '午餐后', valueDown: 5.0, valueUp: 10.0, sortOrder: 2 },
  { code: 'BEDTIME', name: '睡前', valueDown: 5.0, valueUp: 8.3, sortOrder: 3 },
].map((slot) => ({ ...slot, type: TIME_SLOT_CATEGORY.NORMAL, enabled: true }));

/** 应被展示集合排除的三类时段（R1 / 裁定 A、K） */
const EXCLUDED_SLOTS = [
  // 特殊时段：无个体化目标意义（裁定 A）
  {
    code: 'RANDOM',
    name: '随机',
    type: TIME_SLOT_CATEGORY.SPECIAL,
    enabled: true,
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 9,
  },
  // 已停用：历史可展示但不再作为可配置项（裁定 K）
  {
    code: 'INTENSIVE_AM',
    name: '强化早',
    type: TIME_SLOT_CATEGORY.INTENSIVE,
    enabled: true,
    valueDown: 4.4,
    valueUp: 7.0,
    sortOrder: 10,
  },
  // 普通时段但阈值未配：无法作为默认值来源（R1 的第三个条件）
  {
    code: 'DINNER_PRE',
    name: '晚餐前',
    type: TIME_SLOT_CATEGORY.NORMAL,
    enabled: true,
    valueDown: null,
    valueUp: null,
    sortOrder: 11,
  },
];

function patientRow(overrides: Record<string, unknown> = {}) {
  return {
    departmentId: 'd-endo',
    archivedAt: null,
    status: PATIENT_STATUS.INPATIENT,
    ...overrides,
  };
}

/** 库里已有的目标行：阈值是 Decimal（Prisma 读出来的原始形态） */
function targetRow(code: string, down: string, up: string) {
  return {
    timeSlotCode: code,
    valueDown: new Prisma.Decimal(down),
    valueUp: new Prisma.Decimal(up),
  };
}

/** 默认提交 = 展示集合的默认值全量回填（裁定 N 的全量提交语义） */
function updateInput(overrides: Partial<UpdatePatientGlucoseTargetsInput> = {}) {
  return {
    targets: DISPLAY_SLOTS.map((slot) => ({
      timeSlotCode: slot.code,
      valueDown: slot.valueDown,
      valueUp: slot.valueUp,
    })),
    alert: { lowThreshold: 3.9, highThreshold: 16.7 },
    ...overrides,
  };
}

function createService() {
  const prisma = {
    patient: { findUnique: vi.fn() },
    patientGlucoseTarget: {
      findMany: vi.fn(),
      // R4：判定阈值按 (patientId, timeSlotCode) 单行查，不走 findMany
      findUnique: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    patientAlertThreshold: { findUnique: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const timeSlots = { list: vi.fn() };
  const systemConfig = { getGlucoseAlertThreshold: vi.fn() };
  const service = new PatientGlucoseTargetService(
    prisma as never,
    timeSlots as never,
    systemConfig as never,
  );
  return { service, prisma, timeSlots, systemConfig };
}

type Ctx = ReturnType<typeof createService>;
let ctx: Ctx;
let service: Ctx['service'];
let prisma: Ctx['prisma'];
let timeSlots: Ctx['timeSlots'];
let systemConfig: Ctx['systemConfig'];

beforeEach(() => {
  ctx = createService();
  ({ service, prisma, timeSlots, systemConfig } = ctx);
  timeSlots.list.mockResolvedValue([...DISPLAY_SLOTS, ...EXCLUDED_SLOTS]);
  systemConfig.getGlucoseAlertThreshold.mockResolvedValue({ low: 3.9, high: 16.7 });
  prisma.patient.findUnique.mockResolvedValue(patientRow());
  prisma.patientGlucoseTarget.findMany.mockResolvedValue([]);
  // R4：默认「患者无该时段目标行」→ 判定阈值回退全局；有行的场景由对应用例单独覆盖
  prisma.patientGlucoseTarget.findUnique.mockResolvedValue(null);
  // 默认让预警行存在、且值与 updateInput() 的默认 alert 一致：这样「只改时段目标」的用例
  // 不会额外产生 alert.* 变更，changedFields 断言才干净。
  // 预警行缺失的场景由对应用例单独 mockResolvedValue(null) 覆盖。
  prisma.patientAlertThreshold.findUnique.mockResolvedValue({
    lowThreshold: new Prisma.Decimal('3.9'),
    highThreshold: new Prisma.Decimal('16.7'),
  });
});

describe('展示集合过滤（R1 / 裁定 U）', () => {
  it('只保留「启用 + 普通 + 双阈值非空」的时段，排除特殊/强化/未配阈值项', async () => {
    const result = await service.get(allUser, PATIENT_ID);

    expect(result.targets.map((item) => item.timeSlotCode)).toEqual([
      'FASTING',
      'LUNCH_POST',
      'BEDTIME',
    ]);
  });

  it('时段名称与默认值取自 TimeSlot 动态数据，不硬编码', async () => {
    timeSlots.list.mockResolvedValue([
      {
        code: 'FASTING',
        name: '改名后的空腹',
        type: TIME_SLOT_CATEGORY.NORMAL,
        enabled: true,
        valueDown: 3.3,
        valueUp: 6.6,
        sortOrder: 1,
      },
    ]);

    const result = await service.get(allUser, PATIENT_ID);

    expect(result.targets[0]).toMatchObject({
      timeSlotName: '改名后的空腹',
      defaultValueDown: 3.3,
      defaultValueUp: 6.6,
    });
  });
});

describe('get — 存在性与数据权限', () => {
  it('患者不存在 → 40001', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);

    await expect(service.get(allUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
  });

  it('已归档患者按 40001 处理，不泄露存在性', async () => {
    prisma.patient.findUnique.mockResolvedValue(patientRow({ archivedAt: new Date() }));

    await expect(service.get(allUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
  });

  it('本科室账号读他科患者 → 30002', async () => {
    prisma.patient.findUnique.mockResolvedValue(patientRow({ departmentId: 'd-cardio' }));

    await expect(service.get(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
  });

  it('全院范围账号可跨科室读', async () => {
    prisma.patient.findUnique.mockResolvedValue(patientRow({ departmentId: 'd-cardio' }));

    await expect(service.get(allUser, PATIENT_ID)).resolves.toBeDefined();
  });
});

describe('get — 响应组装', () => {
  it('库里缺行的时段返回 null（裁定 K：显示「未设置」而非默认值）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([targetRow('FASTING', '4.4', '7.0')]);

    const result = await service.get(allUser, PATIENT_ID);
    const byCode = new Map(result.targets.map((item) => [item.timeSlotCode, item]));

    expect(byCode.get('FASTING')).toMatchObject({ valueDown: 4.4, valueUp: 7.0 });
    expect(byCode.get('BEDTIME')).toMatchObject({ valueDown: null, valueUp: null });
    // 缺行时默认值仍要给出，供前端「恢复默认」使用
    expect(byCode.get('BEDTIME')).toMatchObject({ defaultValueDown: 5.0, defaultValueUp: 8.3 });
  });

  it('Decimal 出参转 number，前端拿到的是 4.4 而非对象', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([targetRow('FASTING', '4.4', '7.0')]);
    prisma.patientAlertThreshold.findUnique.mockResolvedValue({
      lowThreshold: new Prisma.Decimal('3.9'),
      highThreshold: new Prisma.Decimal('16.7'),
    });

    const result = await service.get(allUser, PATIENT_ID);

    expect(result.targets[0].valueDown).toBe(4.4);
    expect(result.alert).toMatchObject({ lowThreshold: 3.9, highThreshold: 16.7 });
  });

  it('全局阈值读取失败 → default* 为 null 且整个查询不抛（裁定 Q）', async () => {
    systemConfig.getGlucoseAlertThreshold.mockRejectedValue(new Error('10000 配置缺失'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await service.get(allUser, PATIENT_ID);

    expect(result.alert).toMatchObject({
      defaultLowThreshold: null,
      defaultHighThreshold: null,
    });
    // 患者自己的配置仍要正常返回，不能因为全局配置坏了就整个 500
    expect(result.targets).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('预警行不存在 → lowThreshold/highThreshold 为 null，但 default* 仍有值', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue(null);

    const result = await service.get(allUser, PATIENT_ID);

    expect(result.alert).toEqual({
      lowThreshold: null,
      highThreshold: null,
      defaultLowThreshold: 3.9,
      defaultHighThreshold: 16.7,
    });
  });
});

describe('update — 前置校验', () => {
  it('出院患者拒绝编辑 → 40004，且不写库（R11 / 裁定 W）', async () => {
    prisma.patient.findUnique.mockResolvedValue(patientRow({ status: PATIENT_STATUS.DISCHARGED }));

    await expect(service.update(allUser, PATIENT_ID, updateInput())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_INVALID_STATE,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('出院患者仍可查看（读写口径不同）', async () => {
    prisma.patient.findUnique.mockResolvedValue(patientRow({ status: PATIENT_STATUS.DISCHARGED }));

    await expect(service.get(allUser, PATIENT_ID)).resolves.toBeDefined();
  });

  it('提交不在展示集合内的时段码 → 10001，details 定位到具体下标（R3）', async () => {
    const input = updateInput({
      targets: [
        { timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.0 },
        // RANDOM 是特殊时段，不在展示集合内
        { timeSlotCode: 'RANDOM', valueDown: 4.4, valueUp: 7.0 },
      ],
    });

    const error = await service.update(allUser, PATIENT_ID, input).catch((caught) => caught);

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    // details 挂在 HttpException 的 response 对象上、不是实例属性（同 patient.service.spec 口径）
    expect((error.getResponse() as { details?: unknown }).details).toEqual([
      { field: 'targets[1].timeSlotCode', message: '该时段不支持设置控糖目标' },
    ]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('提交已停用时段同样被拒（停用后历史可展示但不可新配）', async () => {
    const input = updateInput({
      targets: [{ timeSlotCode: 'DINNER_PRE', valueDown: 4.4, valueUp: 7.0 }],
    });

    await expect(service.update(allUser, PATIENT_ID, input)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });
});

describe('update — diff 与 changedFields（裁定 L / N / V）', () => {
  it('库里无行、提交有值 → createMany，changedFields 记时段码', async () => {
    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.0 }] }),
    );

    expect(prisma.patientGlucoseTarget.createMany).toHaveBeenCalledWith({
      data: [
        {
          patientId: PATIENT_ID,
          timeSlotCode: 'FASTING',
          valueDown: new Prisma.Decimal('4.4'),
          valueUp: new Prisma.Decimal('7.0'),
        },
      ],
    });
    expect(result.changedFields).toEqual(['FASTING']);
  });

  it('只改下限 → update，changedFields 记复合名 FASTING.valueDown', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([targetRow('FASTING', '4.4', '7.0')]);

    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.0, valueUp: 7.0 }] }),
    );

    expect(prisma.patientGlucoseTarget.update).toHaveBeenCalledWith({
      where: { patientId_timeSlotCode: { patientId: PATIENT_ID, timeSlotCode: 'FASTING' } },
      data: { valueDown: new Prisma.Decimal('4.0'), valueUp: new Prisma.Decimal('7.0') },
    });
    expect(result.changedFields).toEqual(['FASTING.valueDown']);
  });

  it('上下限都改 → changedFields 记两个复合名', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([targetRow('FASTING', '4.4', '7.0')]);

    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.0, valueUp: 8.0 }] }),
    );

    expect(result.changedFields).toEqual(['FASTING.valueDown', 'FASTING.valueUp']);
  });

  it('两值提交 null → deleteMany 删行，不留 null 空壳（裁定 V）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([targetRow('BEDTIME', '5.0', '8.3')]);

    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [{ timeSlotCode: 'BEDTIME', valueDown: null, valueUp: null }] }),
    );

    expect(prisma.patientGlucoseTarget.deleteMany).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID, timeSlotCode: { in: ['BEDTIME'] } },
    });
    expect(result.changedFields).toEqual(['BEDTIME']);
  });

  it('清空一个库里本就不存在的时段 → 不产生删除、不计入 changedFields', async () => {
    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [{ timeSlotCode: 'BEDTIME', valueDown: null, valueUp: null }] }),
    );

    expect(result.changedFields).not.toContain('BEDTIME');
  });

  it('提交值与库中完全一致 → 不写库、changedFields 为空（裁定 L：不产生审计噪声）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([
      targetRow('FASTING', '4.4', '7.0'),
      targetRow('LUNCH_POST', '5.0', '10.0'),
      targetRow('BEDTIME', '5.0', '8.3'),
    ]);
    const result = await service.update(allUser, PATIENT_ID, updateInput());

    expect(result.changedFields).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // 仍要回完整视图供前端刷新
    expect(result.targets).toHaveLength(3);
  });

  it('预警值变更 → changedFields 记 alert.lowThreshold / alert.highThreshold', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue({
      lowThreshold: new Prisma.Decimal('3.9'),
      highThreshold: new Prisma.Decimal('16.7'),
    });

    const result = await service.update(
      allUser,
      PATIENT_ID,
      updateInput({ targets: [], alert: { lowThreshold: 3.5, highThreshold: 16.7 } }),
    );

    expect(result.changedFields).toEqual(['alert.lowThreshold']);
    expect(prisma.patientAlertThreshold.upsert).toHaveBeenCalled();
  });

  it('预警行缺失时提交预警值 → 视为两处变更并 upsert 建行', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue(null);

    const result = await service.update(allUser, PATIENT_ID, updateInput({ targets: [] }));

    expect(result.changedFields).toEqual(['alert.lowThreshold', 'alert.highThreshold']);
    expect(prisma.patientAlertThreshold.upsert).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID },
      update: {
        lowThreshold: new Prisma.Decimal('3.9'),
        highThreshold: new Prisma.Decimal('16.7'),
      },
      create: {
        patientId: PATIENT_ID,
        lowThreshold: new Prisma.Decimal('3.9'),
        highThreshold: new Prisma.Decimal('16.7'),
      },
    });
  });

  it('增删改混合时全部落在同一个事务内（原子性）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([
      targetRow('FASTING', '4.4', '7.0'),
      targetRow('BEDTIME', '5.0', '8.3'),
    ]);

    await service.update(
      allUser,
      PATIENT_ID,
      updateInput({
        targets: [
          { timeSlotCode: 'FASTING', valueDown: 4.0, valueUp: 7.0 }, // 改
          { timeSlotCode: 'LUNCH_POST', valueDown: 5.0, valueUp: 10.0 }, // 增
          { timeSlotCode: 'BEDTIME', valueDown: null, valueUp: null }, // 删
        ],
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.patientGlucoseTarget.deleteMany).toHaveBeenCalled();
    expect(prisma.patientGlucoseTarget.createMany).toHaveBeenCalled();
    expect(prisma.patientGlucoseTarget.update).toHaveBeenCalled();
  });
});

describe('update — 并发冲突', () => {
  it('撞 (patientId, timeSlotCode) 唯一索引 P2002 → 10008，让前端刷新重试', async () => {
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );

    await expect(
      service.update(
        allUser,
        PATIENT_ID,
        updateInput({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.0 }] }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.CONCURRENT_CONFLICT });
  });

  it('非 P2002 的库错误原样抛出，不被误映射成并发冲突', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      service.update(
        allUser,
        PATIENT_ID,
        updateInput({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.0 }] }),
      ),
    ).rejects.toThrow('connection lost');
  });
});

describe('initSnapshot — 建档快照（R9 / 裁定 G、Q）', () => {
  it('写入展示集合全部时段 + 一行预警值', async () => {
    await service.initSnapshot(allUser, PATIENT_ID);

    expect(prisma.patientGlucoseTarget.createMany).toHaveBeenCalledWith({
      data: DISPLAY_SLOTS.map((slot) => ({
        patientId: PATIENT_ID,
        timeSlotCode: slot.code,
        valueDown: new Prisma.Decimal(String(slot.valueDown)),
        valueUp: new Prisma.Decimal(String(slot.valueUp)),
      })),
      // 幂等：与回填脚本或重试并发时撞唯一索引不报错
      skipDuplicates: true,
    });
    expect(prisma.patientAlertThreshold.upsert).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID },
      // 已有行不覆盖：快照只在首次建档写，重跑不得冲掉医护改过的值
      update: {},
      create: {
        patientId: PATIENT_ID,
        lowThreshold: new Prisma.Decimal('3.9'),
        highThreshold: new Prisma.Decimal('16.7'),
      },
    });
  });

  it('SystemConfig 缺失（抛 10000）时不抛出、记 warn —— 不阻断建档（裁定 Q）', async () => {
    systemConfig.getGlucoseAlertThreshold.mockRejectedValue(new Error('10000 配置缺失'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.initSnapshot(allUser, PATIENT_ID)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(prisma.patientGlucoseTarget.createMany).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('展示集合为空时不抛出，只写预警行', async () => {
    timeSlots.list.mockResolvedValue(EXCLUDED_SLOTS);

    await expect(service.initSnapshot(allUser, PATIENT_ID)).resolves.toBeUndefined();

    expect(prisma.patientGlucoseTarget.createMany).not.toHaveBeenCalled();
    expect(prisma.patientAlertThreshold.upsert).toHaveBeenCalled();
  });

  it('事务本身失败也不抛出（内部吞掉全部异常，避免落到建档的 P2002 兜底）', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('deadlock'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.initSnapshot(allUser, PATIENT_ID)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('resolveResultTypeThreshold — R4 判定阈值解析（裁定 E，任务 ④）', () => {
  it('患者有该时段目标行 → 用患者的 valueDown/valueUp，Decimal 转 number', async () => {
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue({
      valueDown: new Prisma.Decimal('4.4'),
      valueUp: new Prisma.Decimal('7.0'),
    });

    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'FASTING')).resolves.toEqual({
      low: 4.4,
      high: 7.0,
    });
    // 复合唯一键查单行，不是 findMany 全捞再内存过滤（§9 非功能要求）
    expect(prisma.patientGlucoseTarget.findUnique).toHaveBeenCalledWith({
      where: { patientId_timeSlotCode: { patientId: PATIENT_ID, timeSlotCode: 'FASTING' } },
      select: { valueDown: true, valueUp: true },
    });
  });

  it('有患者行时不读全局配置（省一次查询）', async () => {
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue({
      valueDown: new Prisma.Decimal('5.0'),
      valueUp: new Prisma.Decimal('8.3'),
    });

    await service.resolveResultTypeThreshold(PATIENT_ID, 'BEDTIME');

    expect(systemConfig.getGlucoseAlertThreshold).not.toHaveBeenCalled();
  });

  it('患者缺行（未设置）→ 回退全局 3.9/16.7（R4 第二行，裁定 K 新增时段不补行同此路径）', async () => {
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue(null);

    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'FASTING')).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
    expect(systemConfig.getGlucoseAlertThreshold).toHaveBeenCalledTimes(1);
  });

  it('强化 / 随机 / 复测时段 → 必然缺行 → 回退全局（R4 第三行，裁定 A）', async () => {
    // R3 禁止给展示集合外的时段写目标行，故库里查不到 → 回退。
    // 用 RANDOM 与 INTENSIVE_AM 各验一次，钉住实现「不按 code 特判、只看有没有行」
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue(null);

    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'RANDOM')).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'INTENSIVE_AM')).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
  });

  it('时段已停用但目标行保留 → 仍用患者值，且**不查展示集合**（R10：历史判定仍可用）', async () => {
    // 停用时段不满足 R1 的 enabled 条件；若实现叠加了 loadDisplaySet 过滤，
    // 这里会退化成全局 3.9/16.7 —— 本用例即钉住该偏差不得发生
    timeSlots.list.mockResolvedValue([
      { ...DISPLAY_SLOTS[0], enabled: false },
      ...DISPLAY_SLOTS.slice(1),
      ...EXCLUDED_SLOTS,
    ]);
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue({
      valueDown: new Prisma.Decimal('4.4'),
      valueUp: new Prisma.Decimal('7.0'),
    });

    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'FASTING')).resolves.toEqual({
      low: 4.4,
      high: 7.0,
    });
    expect(timeSlots.list).not.toHaveBeenCalled();
  });

  it('缺行且全局配置缺失/非法 → 原样抛 10000，不退回任何默认常量（AGENTS.md §4.3）', async () => {
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue(null);
    systemConfig.getGlucoseAlertThreshold.mockRejectedValue(
      new BusinessException(ERROR_CODES.INTERNAL_ERROR),
    );

    await expect(service.resolveResultTypeThreshold(PATIENT_ID, 'FASTING')).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });
});

describe('resolveAlertThreshold — R8 趋势图阈值线（裁定 Y，任务 ④）', () => {
  it('患者有预警行 → 用患者值（Decimal 转 number），不读全局', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue({
      lowThreshold: new Prisma.Decimal('4.0'),
      highThreshold: new Prisma.Decimal('15.0'),
    });

    await expect(service.resolveAlertThreshold(PATIENT_ID)).resolves.toEqual({
      low: 4.0,
      high: 15.0,
    });
    expect(prisma.patientAlertThreshold.findUnique).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID },
      select: { lowThreshold: true, highThreshold: true },
    });
    expect(systemConfig.getGlucoseAlertThreshold).not.toHaveBeenCalled();
  });

  it('患者无预警行 → 回退全局 3.9/16.7（R9 建档快照初始化失败后的路径）', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue(null);

    await expect(service.resolveAlertThreshold(PATIENT_ID)).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
  });

  it('患者行读取异常 → 记 warn 并回退全局（趋势图是只读展示，不整页失败）', async () => {
    prisma.patientAlertThreshold.findUnique.mockRejectedValue(new Error('connection closed'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.resolveAlertThreshold(PATIENT_ID)).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('患者行缺失且全局也读不到 → 抛 10000（与改造前 trend() 行为一致，不新增兜底）', async () => {
    prisma.patientAlertThreshold.findUnique.mockResolvedValue(null);
    systemConfig.getGlucoseAlertThreshold.mockRejectedValue(
      new BusinessException(ERROR_CODES.INTERNAL_ERROR),
    );

    await expect(service.resolveAlertThreshold(PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });

  it('读的是预警值而非时段目标：两者是独立机制（R7 / 裁定 E）', async () => {
    // 目标行设成与预警行明显不同的值，确认趋势图阈值线不受时段目标影响
    prisma.patientGlucoseTarget.findUnique.mockResolvedValue({
      valueDown: new Prisma.Decimal('4.4'),
      valueUp: new Prisma.Decimal('7.0'),
    });
    prisma.patientAlertThreshold.findUnique.mockResolvedValue({
      lowThreshold: new Prisma.Decimal('3.9'),
      highThreshold: new Prisma.Decimal('16.7'),
    });

    await expect(service.resolveAlertThreshold(PATIENT_ID)).resolves.toEqual({
      low: 3.9,
      high: 16.7,
    });
    expect(prisma.patientGlucoseTarget.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveResultTypeThresholdsBatch — P4-7 预警列表控糖范围批量解析', () => {
  /** 批量行：比 targetRow 多 patientId（IN 查询返回形态） */
  function batchRow(patientId: string, code: string, down: string, up: string) {
    return {
      patientId,
      timeSlotCode: code,
      valueDown: new Prisma.Decimal(down),
      valueUp: new Prisma.Decimal(up),
    };
  }

  it('患者 ID 去重后一次 IN 查询 + 全局只读一次（禁止 N+1，规格 §9）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([
      batchRow('p-1', 'FASTING', '4.4', '7.0'),
    ]);

    const result = await service.resolveResultTypeThresholdsBatch(['p-1', 'p-2', 'p-1']);

    expect(prisma.patientGlucoseTarget.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.patientGlucoseTarget.findMany).toHaveBeenCalledWith({
      where: { patientId: { in: ['p-1', 'p-2'] } },
      select: { patientId: true, timeSlotCode: true, valueDown: true, valueUp: true },
    });
    expect(systemConfig.getGlucoseAlertThreshold).toHaveBeenCalledTimes(1);
    expect(result.byPatientSlot.get('p-1|FASTING')).toEqual({ low: 4.4, high: 7.0 });
    expect(result.global).toEqual({ low: 3.9, high: 16.7 });
  });

  it('空患者列表：不查患者行，仍返回全局回退值', async () => {
    const result = await service.resolveResultTypeThresholdsBatch([]);

    expect(prisma.patientGlucoseTarget.findMany).not.toHaveBeenCalled();
    expect(result.byPatientSlot.size).toBe(0);
    expect(result.global).toEqual({ low: 3.9, high: 16.7 });
  });

  it('Decimal 出参转 number，key 为 `patientId|timeSlotCode`（含同一患者多时段行）', async () => {
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([
      batchRow('p-1', 'FASTING', '4.4', '7.0'),
      batchRow('p-1', 'BEDTIME', '5.0', '8.3'),
      batchRow('p-2', 'FASTING', '3.9', '6.1'),
    ]);

    const result = await service.resolveResultTypeThresholdsBatch(['p-1', 'p-2']);

    expect(result.byPatientSlot.get('p-1|FASTING')).toEqual({ low: 4.4, high: 7 });
    expect(result.byPatientSlot.get('p-1|BEDTIME')).toEqual({ low: 5, high: 8.3 });
    expect(result.byPatientSlot.get('p-2|FASTING')).toEqual({ low: 3.9, high: 6.1 });
    expect(result.byPatientSlot.get('p-3|FASTING')).toBeUndefined();
  });

  it('不按展示集合过滤：停用时段的历史目标行照常返回（R10 历史判定仍可用）', async () => {
    // 实现只查 patientGlucoseTarget，不触碰 timeSlots.list —— 钉住该偏差不得发生
    prisma.patientGlucoseTarget.findMany.mockResolvedValue([
      batchRow('p-1', 'INTENSIVE_AM', '4.0', '9.9'),
    ]);

    const result = await service.resolveResultTypeThresholdsBatch(['p-1']);

    expect(result.byPatientSlot.get('p-1|INTENSIVE_AM')).toEqual({ low: 4, high: 9.9 });
    expect(timeSlots.list).not.toHaveBeenCalled();
  });

  it('全局配置缺失/非法 → global 为 null 且整体不抛（读路径不 10000，与 loadDefaultAlert 同取向）', async () => {
    systemConfig.getGlucoseAlertThreshold.mockRejectedValue(
      new BusinessException(ERROR_CODES.INTERNAL_ERROR),
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await service.resolveResultTypeThresholdsBatch(['p-1']);

    expect(result.global).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
