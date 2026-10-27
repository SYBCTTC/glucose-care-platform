import { ERROR_CODES, formatDateTime, GLUCOSE_ENTRY_DETECT } from '@gc/shared';
import type { CreateGlucoseInput } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
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
  };
}

function createService() {
  const prisma = {
    patient: { findUnique: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 'u-nurse' }) },
    glucoseRecord: { create: vi.fn() },
  };
  return { prisma, service: new GlucoseService(prisma as unknown as PrismaService) };
}

describe('GlucoseService.create — 添加血糖', () => {
  let service: GlucoseService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
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

  it('「检测」按阈值判定结果类型：< 3.9 偏低，3.9~16.7 正常，> 16.7 偏高', async () => {
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
});
