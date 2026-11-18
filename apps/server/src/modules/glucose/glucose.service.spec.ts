import { ERROR_CODES, formatDateTime, GLUCOSE_ENTRY_DETECT } from '@gc/shared';
import type { CreateGlucoseInput } from '@gc/shared';
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
    glucoseRecord: { create: vi.fn(), findUnique: vi.fn() },
  };
  // 时段默认存在且启用；单个用例用 mockResolvedValueOnce 覆盖为停用或不存在
  const timeSlots = {
    findByCode: vi.fn().mockResolvedValue({ code: 'FASTING', enabled: true }),
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
