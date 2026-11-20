import {
  ERROR_CODES,
  formatDateTime,
  formatLocalDate,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_REPORT_PAGE_SIZE,
  TIME_SLOT_CATEGORY,
  TIME_SLOT_CODE_RANDOM,
  TIME_SLOTS,
} from '@gc/shared';
import type {
  CreateGlucoseInput,
  GlucoseReportQuery,
  GlucoseReportResponse,
  TimeSlotOption,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import type { SystemConfigService } from '../system/system-config.service';
import type { TimeSlotService } from '../time-slot/time-slot.service';
import { GlucoseService } from './glucose.service';

/** 本科室护士：可录入本科室住院患者的血糖 */
const deptUser = {
  userId: 'u-nurse',
  username: 'nurse.li',
  displayName: '李护士',
  departmentId: 'd-endo',
  departmentName: '内分泌科',
  permissions: [],
  roles: ['NURSE'],
  dataScope: 'DEPARTMENT',
  mustChangePassword: false,
} as unknown as AuthenticatedUser;

const measuredAt = new Date('2026-10-27T02:30:00.000Z');

function createInput(overrides: Partial<CreateGlucoseInput> = {}): CreateGlucoseInput {
  return {
    measuredAt,
    mealContext: 'FASTING',
    resultType: GLUCOSE_ENTRY_DETECT,
    valueMmolL: 8.9,
    testStrip: 2,
    operatorId: 'u-nurse',
    remark: ' 餐前测量 ',
    ...overrides,
  } as CreateGlucoseInput;
}

/** 患者公共选择器返回的行（第二次查询用） */
function patientRow(departmentId = 'd-endo') {
  return {
    id: 'p-1',
    nameMasked: '张**',
    patientNo: 'P2026000004',
    gender: 'MALE',
    birthDate: new Date('1960-01-01T00:00:00.000Z'),
    bedNo: '12-01',
    departmentId,
    department: { name: '内分泌科' },
    doctorId: 'u-doctor',
    doctor: { name: '王医生' },
    status: 'INPATIENT',
    admissionAt: new Date('2026-10-20T00:00:00.000Z'),
    dischargeAt: null,
    archivedAt: null,
    glucoseRecords: [
      { resultType: '1', valueMmolL: new Prisma.Decimal('8.9'), mealContext: 'FASTING', measuredAt },
    ],
    // toListItem 会读 virtualWardRecords 判定 inVirtualWard，mock 行须与 PATIENT_PUBLIC_SELECT 同形
    virtualWardRecords: [],
  };
}

function createService() {
  const prisma = {
    patient: { findUnique: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-nurse' }) },
    glucoseRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      // 报表统计栏（R20）：默认空统计，统计用例各自覆盖
      groupBy: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // 统计「总计」的 counted 码集来源；默认与 seed 一致（0~4 计入，5~9 不计入）
    dictItem: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ code: '0' }, { code: '1' }, { code: '2' }, { code: '3' }, { code: '4' }]),
    },
  };
  // 时段默认存在且启用；单个用例用 mockResolvedValueOnce 覆盖为停用或不存在
  const timeSlots = {
    findByCode: vi.fn().mockResolvedValue({ code: 'FASTING', enabled: true }),
    // 报表用：一次查全（含停用），既生成表头又作归组依据；由报表用例各自 mockResolvedValue
    list: vi.fn(),
  };
  // 阈值默认与 seed 一致（3.9 / 16.7）；单个用例可覆盖，用于验证"改配置即改判定"
  const systemConfig = {
    getGlucoseAlertThreshold: vi.fn().mockResolvedValue({ low: 3.9, high: 16.7 }),
  };
  return {
    prisma,
    timeSlots,
    systemConfig,
    service: new GlucoseService(
      prisma as unknown as PrismaService,
      timeSlots as unknown as TimeSlotService,
      systemConfig as unknown as SystemConfigService,
    ),
  };
}

describe('GlucoseService.create — 添加血糖', () => {
  let service: GlucoseService;
  let prisma: ReturnType<typeof createService>['prisma'];
  let timeSlots: ReturnType<typeof createService>['timeSlots'];
  let systemConfig: ReturnType<typeof createService>['systemConfig'];

  beforeEach(() => {
    ({ service, prisma, timeSlots, systemConfig } = createService());
    // 同一方法被查两次：先查状态/科室，再查列表项；按 select 形状区分
    prisma.patient.findUnique.mockImplementation(
      (args: { select?: Record<string, unknown> } | undefined) =>
        Promise.resolve(
          args?.select?.nameMasked
            ? patientRow()
            : { departmentId: 'd-endo', status: 'INPATIENT', archivedAt: null },
        ),
    );
    prisma.glucoseRecord.create.mockResolvedValue({
      id: 'g-1',
      resultType: '1',
      valueMmolL: new Prisma.Decimal('8.9'),
      measuredAt,
    });
  });

  it('「检测」按 SystemConfig 阈值判定：< low 偏低，low~high 正常，> high 偏高（含边界）', async () => {
    // 阈值取自 systemConfig 模拟（3.9 / 16.7，与 seed 一致），不是代码里的常量
    for (const [value, expected] of [
      [0.6, '0'],
      [3.9, '1'],
      [16.7, '1'],
      [16.8, '2'],
      [33.3, '2'],
    ] as const) {
      prisma.glucoseRecord.create.mockResolvedValueOnce({
        id: 'g-1',
        resultType: expected,
        valueMmolL: new Prisma.Decimal(value.toFixed(1)),
        measuredAt,
      });
      await service.create(deptUser, 'p-1', createInput({ valueMmolL: value }));
      const calls = prisma.glucoseRecord.create.mock.calls;
      const args = calls[calls.length - 1][0];
      expect(args.data.resultType).toBe(expected);
      expect(args.data.valueMmolL).toBeInstanceOf(Prisma.Decimal);
    }
  });

  it('改配置即改判定：阈值调成 5.0/12.0 后，同一个 8.9 仍正常，但 4.5 变偏低、13.0 变偏高', async () => {
    systemConfig.getGlucoseAlertThreshold.mockResolvedValue({ low: 5.0, high: 12.0 });

    for (const [value, expected] of [
      [4.5, '0'],
      [5.0, '1'],
      [8.9, '1'],
      [12.0, '1'],
      [13.0, '2'],
    ] as const) {
      prisma.glucoseRecord.create.mockResolvedValueOnce({
        id: 'g-1',
        resultType: expected,
        valueMmolL: new Prisma.Decimal(value.toFixed(1)),
        measuredAt,
      });
      await service.create(deptUser, 'p-1', createInput({ valueMmolL: value }));
      const calls = prisma.glucoseRecord.create.mock.calls;
      expect(calls[calls.length - 1][0].data.resultType).toBe(expected);
    }
  });

  it('阈值读取失败（配置缺失/非法）时拒绝写入，不退回任何默认常量', async () => {
    systemConfig.getGlucoseAlertThreshold.mockRejectedValueOnce(
      new BusinessException(ERROR_CODES.INTERNAL_ERROR),
    );

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
    expect(prisma.glucoseRecord.create).not.toHaveBeenCalled();
  });

  it('选择 3~9 时不读系统配置（无需阈值判定，省一次查询）', async () => {
    prisma.glucoseRecord.create.mockResolvedValueOnce({
      id: 'g-3',
      resultType: '5',
      valueMmolL: null,
      measuredAt,
    });

    await service.create(
      deptUser,
      'p-1',
      createInput({ resultType: '5', valueMmolL: null, testStrip: null }),
    );

    expect(systemConfig.getGlucoseAlertThreshold).not.toHaveBeenCalled();
  });

  it('选择 3~9 时不落血糖值与试纸，resultType 原样入库', async () => {
    prisma.glucoseRecord.create.mockResolvedValueOnce({
      id: 'g-2',
      resultType: '5',
      valueMmolL: null,
      measuredAt,
    });

    await service.create(
      deptUser,
      'p-1',
      createInput({ resultType: '5', valueMmolL: null, testStrip: null }),
    );

    const args = prisma.glucoseRecord.create.mock.calls[0][0];
    expect(args.data.resultType).toBe('5');
    expect(args.data.valueMmolL).toBeNull();
    expect(args.data.testStrip).toBeNull();
  });

  it('记录者与备注、试纸、时段按入参落库，备注两端空白被裁剪', async () => {
    await service.create(deptUser, 'p-1', createInput());

    const args = prisma.glucoseRecord.create.mock.calls[0][0];
    expect(args.data.operatorId).toBe('u-nurse');
    expect(args.data.testStrip).toBe(2);
    expect(args.data.remark).toBe('餐前测量');
    expect(args.data.mealContext).toBe('FASTING');
    expect(args.data.measuredAt).toEqual(measuredAt);
  });

  it('返回更新后的列表项，供前端直接替换该行', async () => {
    const result = await service.create(deptUser, 'p-1', createInput());

    expect(result.resultType).toBe('1');
    expect(result.valueMmolL).toBe(8.9);
    expect(result.measuredAt).toBe(formatDateTime(measuredAt));
    expect(result.item.id).toBe('p-1');
    expect(result.item.lastGlucoseValue).toBe(8.9);
  });

  it('出院患者不允许录入血糖（40004）', async () => {
    prisma.patient.findUnique
      .mockReset()
      .mockResolvedValueOnce({ departmentId: 'd-endo', status: 'DISCHARGED', archivedAt: null });

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_INVALID_STATE,
    });
  });

  it('跨科室患者被数据范围拦下（30002），且不写库', async () => {
    prisma.patient.findUnique
      .mockReset()
      .mockResolvedValueOnce({ departmentId: 'd-cardio', status: 'INPATIENT', archivedAt: null });

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.glucoseRecord.create).not.toHaveBeenCalled();
  });

  it('已归档患者按"不存在"处理（40001）', async () => {
    prisma.patient.findUnique
      .mockReset()
      .mockResolvedValueOnce({
        departmentId: 'd-endo',
        status: 'INPATIENT',
        archivedAt: new Date(),
      });

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
  });

  it('记录者不存在或已停用时按字段级校验错误返回（10001）', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(prisma.glucoseRecord.create).not.toHaveBeenCalled();
  });

  it('检测时段查库校验：库里存在且启用即放行，不再受静态清单限制', async () => {
    timeSlots.findByCode.mockResolvedValueOnce({ code: 'CUSTOM_SLOT', enabled: true });

    await service.create(deptUser, 'p-1', createInput({ mealContext: 'CUSTOM_SLOT' }));

    expect(timeSlots.findByCode).toHaveBeenCalledWith(deptUser, 'CUSTOM_SLOT');
    expect(prisma.glucoseRecord.create.mock.calls[0][0].data.mealContext).toBe('CUSTOM_SLOT');
  });

  it('检测时段在库里不存在时按字段级校验错误返回（10001），且不写库', async () => {
    timeSlots.findByCode.mockResolvedValueOnce(null);

    const error = await service.create(deptUser, 'p-1', createInput()).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect((error as BusinessException).getResponse()).toMatchObject({
      details: [{ field: 'mealContext', message: '检测时段不存在' }],
    });
    expect(prisma.glucoseRecord.create).not.toHaveBeenCalled();
  });

  it('检测时段已停用时拒绝新录入（10001），且不写库', async () => {
    timeSlots.findByCode.mockResolvedValueOnce({ code: 'FASTING', enabled: false });

    const error = await service.create(deptUser, 'p-1', createInput()).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect((error as BusinessException).getResponse()).toMatchObject({
      details: [{ field: 'mealContext', message: '检测时段已停用' }],
    });
    expect(prisma.glucoseRecord.create).not.toHaveBeenCalled();
  });

  it('正常录入 skipped=false', async () => {
    const result = await service.create(deptUser, 'p-1', createInput());

    expect(result.skipped).toBe(false);
    expect(prisma.glucoseRecord.findUnique).not.toHaveBeenCalled();
  });

  it('同患者同检测时间重复提交：命中唯一约束后幂等跳过，返回已有记录且不抛错', async () => {
    prisma.glucoseRecord.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['patientId', 'measuredAt'] },
      }),
    );
    prisma.glucoseRecord.findUnique.mockResolvedValueOnce({
      id: 'g-existing',
      resultType: '1',
      valueMmolL: new Prisma.Decimal('6.1'),
      measuredAt,
    });

    const result = await service.create(deptUser, 'p-1', createInput({ valueMmolL: 8.9 }));

    expect(result.skipped).toBe(true);
    expect(result.id).toBe('g-existing');
    // 返回的是已有记录的值，而不是本次提交值
    expect(result.valueMmolL).toBe(6.1);
    expect(result.item.id).toBe('p-1');
    expect(prisma.glucoseRecord.findUnique).toHaveBeenCalledWith({
      where: { patientId_measuredAt: { patientId: 'p-1', measuredAt } },
      select: { id: true, resultType: true, valueMmolL: true, measuredAt: true },
    });
  });

  it('唯一约束命中但回读不到记录时保留原始错误，不掩盖故障', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
    });
    prisma.glucoseRecord.create.mockRejectedValueOnce(conflict);
    prisma.glucoseRecord.findUnique.mockResolvedValueOnce(null);

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toBe(conflict);
  });

  it('写库出现非唯一约束错误时原样抛出', async () => {
    prisma.glucoseRecord.create.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.create(deptUser, 'p-1', createInput())).rejects.toThrow('connection reset');
    expect(prisma.glucoseRecord.findUnique).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* GlucoseService.report — 血糖报告                                            */
/* -------------------------------------------------------------------------- */

/**
 * 报表夹具**直接复用 seed 清单**（8 普通 + 2 特殊 + 3 强化），避免与库数据漂移。
 * `pickTimeSlotByTime` 只认普通时段的区间，故必须给全 24h 覆盖的真实区间，不能自造简化版。
 */
const reportSlots: TimeSlotOption[] = TIME_SLOTS.map((slot) => ({
  ...slot,
  timeScope: slot.startTime && slot.endTime ? `${slot.startTime}-${slot.endTime}` : null,
  enabled: true,
}));

/** NONE 档（设备管理员）：无患者数据范围 */
const noneUser = {
  ...deptUser,
  dataScope: 'NONE',
  roles: ['DEVICE_ADMIN'],
} as unknown as AuthenticatedUser;

/** 报表明细行，与 service 的 `select` 同形 */
type ReportRow = {
  resultType: string;
  valueMmolL: Prisma.Decimal | null;
  mealContext: string | null;
  measuredAt: Date;
  operator: { name: string } | null;
};

/**
 * 造一条 2026-11-`day` 本地 `hour:minute` 的记录。
 * ⚠️ 必须用**本地**构造器：报表按本地日历日分组，用 `new Date('...Z')` 会让断言随运行环境时区漂移。
 */
function rec(
  day: number,
  hour: number,
  minute: number,
  mealContext: string | null,
  overrides: Partial<ReportRow> = {},
): ReportRow {
  return {
    resultType: '1',
    valueMmolL: new Prisma.Decimal('6.8'),
    mealContext,
    measuredAt: new Date(2026, 10, day, hour, minute),
    operator: { name: '李护士' },
    ...overrides,
  };
}

/**
 * 报表用的 service 工厂。
 * `glucoseRecord.findMany` 被调两次，按 `select` 是否含 `operator` 区分：
 * 第一次只取 `measuredAt`（降序，供本地日期去重分页），第二次取明细（升序，供矩阵组装）。
 * 明细查询刻意**不按 where 过滤**，以验证 service 自身会用 pageDates 兜住越界记录。
 */
function createReportService(rows: ReportRow[], slots: TimeSlotOption[] = reportSlots) {
  const ctx = createService();
  ctx.prisma.patient.findUnique.mockResolvedValue({
    departmentId: 'd-endo',
    archivedAt: null,
  });
  ctx.timeSlots.list.mockResolvedValue(slots);
  ctx.prisma.glucoseRecord.findMany.mockImplementation(
    (args: { select?: Record<string, unknown> } | undefined) => {
      const asc = [...rows].sort(
        (left, right) => left.measuredAt.getTime() - right.measuredAt.getTime(),
      );
      return Promise.resolve(
        args?.select?.operator
          ? asc
          : asc
              .slice()
              .reverse()
              .map((row) => ({ measuredAt: row.measuredAt })),
      );
    },
  );
  return ctx;
}

function query(overrides: Partial<GlucoseReportQuery> = {}): GlucoseReportQuery {
  return { page: 1, pageSize: GLUCOSE_REPORT_PAGE_SIZE, ...overrides };
}

/** 取某日期行、某时段列的 entries；不存在时返回空数组 */
function cellOf(result: GlucoseReportResponse, date: string, slotCode: string) {
  return (
    result.rows
      .find((row) => row.date === date)
      ?.cells.find((cell) => cell.slotCode === slotCode)?.entries ?? []
  );
}

describe('GlucoseService.report — 血糖报告', () => {
  it('表头 = 8 普通 + 2 特殊 = 10 列，按 sortOrder 升序；强化时段不成列', async () => {
    const { service } = createReportService([]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.columns.map((column) => column.code)).toEqual([
      'FASTING',
      'BREAKFAST_PRE',
      'BREAKFAST_POST',
      'LUNCH_PRE',
      'LUNCH_POST',
      'DINNER_PRE',
      'DINNER_POST',
      'BEDTIME',
      TIME_SLOT_CODE_RANDOM,
      'RETEST',
    ]);
    // 强化时段（type=0）不单独成列：所有列的类型只能是普通(1)或特殊(4)
    expect(
      result.columns.every(
        (column) =>
          column.type === TIME_SLOT_CATEGORY.NORMAL || column.type === TIME_SLOT_CATEGORY.SPECIAL,
      ),
    ).toBe(true);
  });

  it('弃用特殊时段不再成列：历史记录按检测时间合并进启用列，带弃用时段名后缀（R22）', async () => {
    const slots = reportSlots.map((slot) =>
      slot.code === 'RETEST' ? { ...slot, enabled: false } : slot,
    );
    // 09:05 落在启用的 BREAKFAST_POST [08:00, 11:00)
    const { service } = createReportService([rec(19, 9, 5, 'RETEST')], slots);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.columns.some((column) => column.code === 'RETEST')).toBe(false);
    const entries = cellOf(result, '2026-11-19', 'BREAKFAST_POST');
    expect(entries).toHaveLength(1);
    // 裁定 Q1：后缀是**弃用时段自己的名称**；裁定 Q4：sourceType 保留原类型（特殊）
    expect(entries[0].sourceSlotName).toBe('复测');
    expect(entries[0].sourceType).toBe(TIME_SLOT_CATEGORY.SPECIAL);
  });

  it('弃用普通时段：原区间无启用宿主 → 兜底随机列，保留后缀与原类型（R22）', async () => {
    const slots = reportSlots.map((slot) =>
      slot.code === 'BEDTIME' ? { ...slot, enabled: false } : slot,
    );
    const { service } = createReportService([rec(19, 22, 30, 'BEDTIME')], slots);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.columns.some((column) => column.code === 'BEDTIME')).toBe(false);
    const entries = cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM);
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceSlotName).toBe('睡前');
    expect(entries[0].sourceType).toBe(TIME_SLOT_CATEGORY.NORMAL);
  });

  it('启用的普通/特殊记录落自己的列：sourceType 为原类型、无后缀（R22）', async () => {
    const { service } = createReportService([
      rec(19, 9, 0, 'BREAKFAST_POST'),
      rec(19, 9, 30, TIME_SLOT_CODE_RANDOM),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    const normal = cellOf(result, '2026-11-19', 'BREAKFAST_POST')[0];
    expect(normal.sourceType).toBe(TIME_SLOT_CATEGORY.NORMAL);
    expect(normal.sourceSlotName).toBeNull();
    const special = cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM)[0];
    expect(special.sourceType).toBe(TIME_SLOT_CATEGORY.SPECIAL);
    expect(special.sourceSlotName).toBeNull();
  });

  it('强化时段按检测时间归入普通时段列，并带上强化时段名', async () => {
    const { service } = createReportService([rec(19, 9, 0, 'INTENSIVE_AM')]);

    const result = await service.report(deptUser, 'p-1', query());

    // 09:00 落在 BREAKFAST_POST 的 [08:00, 11:00)
    const entries = cellOf(result, '2026-11-19', 'BREAKFAST_POST');
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceSlotName).toBe('强化-上午');
    expect(entries[0].sourceType).toBe(TIME_SLOT_CATEGORY.INTENSIVE);
    expect(entries[0].time).toBe('09:00');
    expect(result.columns.some((column) => column.code === 'INTENSIVE_AM')).toBe(false);
  });

  it('强化宿主只认启用的普通时段：宿主停用后落兜底随机列（R22，替代原 R5 忽略 enabled 口径）', async () => {
    const slots = reportSlots.map((slot) =>
      slot.code === 'BREAKFAST_POST' ? { ...slot, enabled: false } : slot,
    );
    const { service } = createReportService([rec(19, 9, 0, 'INTENSIVE_AM')], slots);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.columns.some((column) => column.code === 'BREAKFAST_POST')).toBe(false);
    const entries = cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM);
    expect(entries[0]?.sourceSlotName).toBe('强化-上午');
    expect(entries[0]?.sourceType).toBe(TIME_SLOT_CATEGORY.INTENSIVE);
  });

  it('强化归组遇区间空洞 → 落随机列且保留强化后缀', async () => {
    const slots = reportSlots.filter((slot) => slot.code !== 'BREAKFAST_POST');
    const { service } = createReportService([rec(19, 9, 0, 'INTENSIVE_AM')], slots);

    const result = await service.report(deptUser, 'p-1', query());

    const entries = cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM);
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceSlotName).toBe('强化-上午');
  });

  it('特殊时段直接落自己的列，不做时间归组', async () => {
    const { service } = createReportService([
      rec(19, 9, 0, TIME_SLOT_CODE_RANDOM),
      rec(19, 9, 30, 'RETEST'),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    // 09:00/09:30 若做时间归组会落 BREAKFAST_POST；特殊时段必须留在原列
    expect(cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM)).toHaveLength(1);
    expect(cellOf(result, '2026-11-19', 'RETEST')).toHaveLength(1);
    expect(cellOf(result, '2026-11-19', 'BREAKFAST_POST')).toHaveLength(0);
  });

  it('mealContext 为 null 或库里不存在的 code → 落随机列，不丢记录（R13）', async () => {
    const { service } = createReportService([
      rec(19, 9, 0, null),
      rec(19, 10, 0, 'SLOT_DELETED_FROM_DB'),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    const entries = cellOf(result, '2026-11-19', TIME_SLOT_CODE_RANDOM);
    expect(entries).toHaveLength(2);
    // R22：来源不明的兜底记录按特殊对待（前端恒展示，宁可多展示不可丢数据）
    expect(entries.every((entry) => entry.sourceType === TIME_SLOT_CATEGORY.SPECIAL)).toBe(true);
    expect(result.count).toBe(2);
  });

  it('单元格多条按 measuredAt 升序堆叠（R4）', async () => {
    const { service } = createReportService([
      rec(19, 10, 0, 'BREAKFAST_POST'),
      rec(19, 8, 30, 'BREAKFAST_POST'),
      rec(19, 9, 15, 'BREAKFAST_POST'),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(cellOf(result, '2026-11-19', 'BREAKFAST_POST').map((entry) => entry.time)).toEqual([
      '08:30',
      '09:15',
      '10:00',
    ]);
  });

  it('日期降序且不补空行：无数据的日期不出现在 rows', async () => {
    const { service } = createReportService([
      rec(15, 8, 0, 'BREAKFAST_POST'),
      rec(19, 8, 0, 'BREAKFAST_POST'),
      rec(17, 8, 0, 'BREAKFAST_POST'),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    // 16、18 号无数据 → 不补空行
    expect(result.rows.map((row) => row.date)).toEqual([
      '2026-11-19',
      '2026-11-17',
      '2026-11-15',
    ]);
    expect(result.total).toBe(3);
  });

  it('分页单位是**日期**而非记录条数（R7）', async () => {
    // 18 个有数据的日期，其中 11-05 有 3 条 → 记录 20 条、日期 18 个
    const rows: ReportRow[] = [];
    for (let day = 1; day <= 18; day += 1) {
      rows.push(rec(day, 8, 0, 'BREAKFAST_POST'));
      if (day === 5) {
        rows.push(rec(day, 12, 0, 'LUNCH_POST'));
        rows.push(rec(day, 18, 0, 'DINNER_POST'));
      }
    }
    const { service } = createReportService(rows);

    const page1 = await service.report(deptUser, 'p-1', query({ page: 1 }));
    expect(page1.total).toBe(18); // 日期总数，不是 20
    expect(page1.rows).toHaveLength(15);
    expect(page1.rows[0].date).toBe('2026-11-18');
    expect(page1.count).toBe(17); // 覆盖 11-04..11-18，含 11-05 的 3 条

    const page2 = await service.report(deptUser, 'p-1', query({ page: 2 }));
    expect(page2.total).toBe(18);
    expect(page2.rows.map((row) => row.date)).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
    ]);
    expect(page2.count).toBe(3);
  });

  it('明细查询按本页日期窗口过滤：本地零点 → 次日本地零点，左闭右开', async () => {
    const { service, prisma } = createReportService([
      rec(19, 8, 0, 'BREAKFAST_POST'),
      rec(20, 8, 0, 'BREAKFAST_POST'),
    ]);

    await service.report(deptUser, 'p-1', query());

    const calls = prisma.glucoseRecord.findMany.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].where.measuredAt).toEqual({
      gte: new Date(2026, 10, 19),
      lt: new Date(2026, 10, 21),
    });
  });

  it('时区（必测）：UTC 跨日的记录归入**本地**日期', async () => {
    // 本地 2026-11-19 00:30；东八区下对应 UTC 2026-11-18 16:30
    const early = new Date(2026, 10, 19, 0, 30);
    const { service } = createReportService([
      { ...rec(19, 0, 30, 'FASTING'), measuredAt: early },
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.rows.map((row) => row.date)).toEqual(['2026-11-19']);
    expect(cellOf(result, '2026-11-19', 'FASTING')[0]?.time).toBe('00:30');

    // 东时区下该时刻的 UTC 日期确实是前一天 → 证明报表没有误用 UTC 口径
    if (-early.getTimezoneOffset() > 0) {
      expect(early.toISOString().slice(0, 10)).toBe('2026-11-18');
      expect(result.rows.some((row) => row.date === '2026-11-18')).toBe(false);
    }
    expect(formatLocalDate(early)).toBe('2026-11-19');
  });

  it('valueMmolL 为 null 时原样返回 null + resultType（前端据此显示字典标签）', async () => {
    const { service } = createReportService([
      rec(19, 8, 0, 'BREAKFAST_POST', { valueMmolL: null, resultType: '3' }),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    const entry = cellOf(result, '2026-11-19', 'BREAKFAST_POST')[0];
    expect(entry.valueMmolL).toBeNull();
    expect(entry.resultType).toBe('3');
  });

  it('operatorId 为空 → nurseName 为 null', async () => {
    const { service } = createReportService([
      rec(19, 8, 0, 'BREAKFAST_POST', { operator: null }),
    ]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(cellOf(result, '2026-11-19', 'BREAKFAST_POST')[0]?.nurseName).toBeNull();
  });

  it('每行 cells 与 columns 等长同序', async () => {
    const { service } = createReportService([rec(19, 8, 0, 'BREAKFAST_POST')]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.rows[0].cells.map((cell) => cell.slotCode)).toEqual(
      result.columns.map((column) => column.code),
    );
  });

  it('回显 rangeFrom/rangeTo/count 供审计 detail 提取；未传范围时为 null', async () => {
    const { service } = createReportService([rec(19, 8, 0, 'BREAKFAST_POST')]);

    const noRange = await service.report(deptUser, 'p-1', query());
    expect(noRange.rangeFrom).toBeNull();
    expect(noRange.rangeTo).toBeNull();
    expect(noRange.count).toBe(1);

    const withRange = await service.report(
      deptUser,
      'p-1',
      query({ startDate: '2026-11-01', endDate: '2026-11-30' }),
    );
    expect(withRange.rangeFrom).toBe('2026-11-01');
    expect(withRange.rangeTo).toBe('2026-11-30');
  });

  it('日期范围按**本地日界**过滤，而非 UTC 零点', async () => {
    const { service, prisma } = createReportService([]);

    await service.report(deptUser, 'p-1', query({ startDate: '2026-11-01', endDate: '2026-11-30' }));

    expect(prisma.glucoseRecord.findMany.mock.calls[0][0].where.measuredAt).toEqual({
      gte: new Date(2026, 10, 1),
      lt: new Date(2026, 11, 1),
    });
  });

  it('不存在的日期（2026-02-30）→ 10001 + 字段级 details', async () => {
    const { service } = createReportService([]);

    await expect(
      service.report(deptUser, 'p-1', query({ startDate: '2026-02-30' })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('结束日期早于开始日期 → 10001', async () => {
    const { service } = createReportService([]);

    await expect(
      service.report(deptUser, 'p-1', query({ startDate: '2026-11-30', endDate: '2026-11-01' })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('跨科室患者 → 30002，且不发血糖查询', async () => {
    const { service, prisma } = createReportService([]);
    prisma.patient.findUnique.mockResolvedValue({ departmentId: 'd-cardio', archivedAt: null });

    await expect(service.report(deptUser, 'p-1', query())).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.glucoseRecord.findMany).not.toHaveBeenCalled();
  });

  it('NONE 档（设备管理员）→ 30006，且不发血糖查询', async () => {
    const { service, prisma } = createReportService([]);

    await expect(service.report(noneUser, 'p-1', query())).rejects.toMatchObject({
      code: ERROR_CODES.NO_PATIENT_DATA_SCOPE,
    });
    expect(prisma.glucoseRecord.findMany).not.toHaveBeenCalled();
  });

  it('患者不存在或已归档 → 40001，不泄露存在性', async () => {
    const { service, prisma } = createReportService([]);

    prisma.patient.findUnique.mockResolvedValue(null);
    await expect(service.report(deptUser, 'p-1', query())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });

    prisma.patient.findUnique.mockResolvedValue({
      departmentId: 'd-endo',
      archivedAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await expect(service.report(deptUser, 'p-1', query())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.glucoseRecord.findMany).not.toHaveBeenCalled();
  });

  it('只校验存在/归档/数据范围，不校验住院状态：出院患者历史血糖同样可查', async () => {
    const { service, prisma } = createReportService([rec(19, 8, 0, 'BREAKFAST_POST')]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.total).toBe(1);
    // select 不含 status → 与 create() 的「必须住院中」口径明确区分
    expect(prisma.patient.findUnique.mock.calls[0][0].select).toEqual({
      departmentId: true,
      archivedAt: true,
    });
  });

  it('无数据时返回空 rows、total=0，且不发第二次查询', async () => {
    const { service, prisma } = createReportService([]);

    const result = await service.report(deptUser, 'p-1', query());

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.count).toBe(0);
    expect(prisma.glucoseRecord.findMany).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------- 报表统计栏（R20，2026-11-19 裁定） ---------------------- */

describe('GlucoseService.report — 统计栏（R20）', () => {
  /** groupBy 夹具：码 → 条数 映射转 `{ resultType, _count }` 形状 */
  function groupFixture(counts: Record<string, number>) {
    return Object.entries(counts).map(([resultType, n]) => ({
      resultType,
      _count: { _all: n },
    }));
  }

  it('总计只数字典 counted=true 的码（当前种子 0~4），5~9 不计入；合格 = "1" 条数', async () => {
    const { service, prisma } = createReportService([]);
    prisma.glucoseRecord.groupBy.mockResolvedValue(
      groupFixture({ '0': 2, '1': 10, '2': 3, '3': 1, '4': 1, '5': 4, '6': 2, '9': 7 }),
    );

    const { stats } = await service.report(deptUser, 'p-1', query());

    expect(stats.total).toBe(17); // 2+10+3+1+1，不含 5/6/9 的 13 条
    expect(stats.qualified).toBe(10);
  });

  it('counted 码集是字典数据驱动：改字典 counted 码集，总计口径即跟随', async () => {
    const { service, prisma } = createReportService([]);
    prisma.dictItem.findMany.mockResolvedValue([{ code: '0' }, { code: '1' }, { code: '2' }]);
    prisma.glucoseRecord.groupBy.mockResolvedValue(groupFixture({ '1': 5, '3': 2, '4': 3 }));

    const { stats } = await service.report(deptUser, 'p-1', query());

    expect(stats.total).toBe(5); // '3'/'4' 不在 counted 集合
    expect(prisma.dictItem.findMany.mock.calls[0][0].where).toMatchObject({ counted: true });
  });

  it('hasHigh/hasLow：范围内存在 "4"/"3" 记录即为 true', async () => {
    const { service, prisma } = createReportService([]);
    prisma.glucoseRecord.groupBy.mockResolvedValue(groupFixture({ '1': 1, '3': 1, '4': 2 }));

    const { stats } = await service.report(deptUser, 'p-1', query());

    expect(stats.hasHigh).toBe(true);
    expect(stats.hasLow).toBe(true);
  });

  it('数值极值取记录本身：valueMmolL 转 number + 自身 resultType（供前端按字典色着色）', async () => {
    const { service, prisma } = createReportService([]);
    prisma.glucoseRecord.findFirst
      .mockResolvedValueOnce({ valueMmolL: new Prisma.Decimal('18.5'), resultType: '2' }) // desc → 最大
      .mockResolvedValueOnce({ valueMmolL: new Prisma.Decimal('3.2'), resultType: '0' }); // asc → 最小

    const { stats } = await service.report(deptUser, 'p-1', query());

    expect(stats.maxValueMmolL).toBe(18.5);
    expect(stats.maxResultType).toBe('2');
    expect(stats.minValueMmolL).toBe(3.2);
    expect(stats.minResultType).toBe('0');
    // 极值只查数值型(0/1/2)且有值的记录
    expect(prisma.glucoseRecord.findFirst.mock.calls[0][0].where.resultType).toEqual({
      in: ['0', '1', '2'],
    });
    expect(prisma.glucoseRecord.findFirst.mock.calls[0][0].where.valueMmolL).toEqual({
      not: null,
    });
  });

  it('无数值记录 → 极值为 null（前端显示 -）；hasHigh/hasLow 仍按存在性判定', async () => {
    const { service, prisma } = createReportService([]);
    prisma.glucoseRecord.groupBy.mockResolvedValue(groupFixture({ '4': 1 }));

    const { stats } = await service.report(deptUser, 'p-1', query());

    expect(stats.maxValueMmolL).toBeNull();
    expect(stats.maxResultType).toBeNull();
    expect(stats.minValueMmolL).toBeNull();
    expect(stats.minResultType).toBeNull();
    expect(stats.hasHigh).toBe(true);
    expect(stats.hasLow).toBe(false);
  });

  it('统计与分页无关：page=2 时 groupBy/极值仍用全范围 where（含日期范围条件）', async () => {
    const { service, prisma } = createReportService([]);

    await service.report(
      deptUser,
      'p-1',
      query({ page: 2, startDate: '2026-11-01', endDate: '2026-11-30' }),
    );

    const expectedWhere = {
      patientId: 'p-1',
      measuredAt: { gte: new Date(2026, 10, 1), lt: new Date(2026, 11, 1) },
    };
    expect(prisma.glucoseRecord.groupBy.mock.calls[0][0].where).toEqual(expectedWhere);
    expect(prisma.glucoseRecord.findFirst.mock.calls[0][0].where).toMatchObject(expectedWhere);
  });
});
