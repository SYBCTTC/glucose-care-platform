import { ERROR_CODES, PATIENT_STATUS, WARD_LEAVE_REASON, WARD_TAB } from '@gc/shared';
import type { WardListQuery } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { WardService } from './ward.service';

/**
 * 虚拟病区服务单测。
 *
 * 重点覆盖 AGENTS.md §6.7 要求的"权限、越权、边界值"：
 *  - 数据权限沿用患者域：跨科室 30002、设备管理员（NONE 档）30006，且越权时不写库；
 *  - 加入的并发兜底：先查后判被绕过时撞部分唯一索引（P2002）→ 44001，不漏成 50000；
 *  - 移出的并发兜底：updateMany 原子更新 count=0 → 44002，不覆盖对方的移出时间；
 *  - 列表口径：CURRENT 看在区行按 joinedAt 排序，HISTORY 看已移出行按 leftAt 排序，
 *    且 scope 过滤挂在 where.patient 上（沿用 RESOURCE.PATIENT，不新增资源）。
 */

const PATIENT_ID = 'p-1';
const JOINED_AT = new Date('2026-11-18T02:00:00.000Z');

/** 本科室护士：DEPARTMENT 档，只见本科室患者 */
const deptUser = {
  userId: 'u-nurse',
  username: 'nurse.li',
  displayName: '李护士',
  departmentId: 'd-endo',
  departmentName: '内分泌科',
  permissions: [],
  roles: ['NURSE'],
  dataScope: 'DEPARTMENT',
} as unknown as AuthenticatedUser;

/** 系统管理员：ALL 档，全院 */
const allUser = { ...deptUser, userId: 'u-admin', dataScope: 'ALL' } as unknown as AuthenticatedUser;

/** 设备管理员：NONE 档，无患者数据权限 */
const noneUser = {
  userId: 'u-device',
  username: 'device.admin',
  displayName: '设备管理员',
  departmentId: 'd-device',
  departmentName: '设备科',
  permissions: [],
  roles: ['DEVICE_ADMIN'],
  dataScope: 'NONE',
} as unknown as AuthenticatedUser;

/** join/leave 第一次查患者的行（只取状态/科室/归档） */
function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    departmentId: 'd-endo',
    status: PATIENT_STATUS.INPATIENT,
    archivedAt: null,
    ...overrides,
  };
}

/** PATIENT_PUBLIC_SELECT 形状的行（join 成功后回读、list 行内嵌患者） */
function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PATIENT_ID,
    nameMasked: '张**',
    patientNo: 'H-0001',
    gender: 'MALE',
    birthDate: new Date('1960-01-01T00:00:00.000Z'),
    bedNo: '12-01',
    departmentId: 'd-endo',
    department: { name: '内分泌科' },
    doctorId: 'u-doctor',
    doctor: { name: '王医生' },
    status: PATIENT_STATUS.INPATIENT,
    admissionAt: new Date('2026-10-20T00:00:00.000Z'),
    dischargeAt: null,
    archivedAt: null,
    glucoseRecords: [],
    virtualWardRecords: [],
    ...overrides,
  };
}

/** 列表行：进出记录 + 内嵌患者公开字段 */
function wardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    joinedAt: JOINED_AT,
    leftAt: null,
    leaveReason: null,
    patient: publicRow(),
    ...overrides,
  };
}

function createService() {
  const prisma = {
    patient: { findUnique: vi.fn() },
    virtualWardRecord: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    // list 用 $transaction([findMany, count])；直接并行执行两个 promise 即可
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const service = new WardService(prisma as unknown as PrismaService);
  return { service, prisma };
}

/** Prisma 唯一约束冲突（P2002），用于模拟并发撞部分唯一索引 */
function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

describe('WardService.join — 加入虚拟病区', () => {
  let service: WardService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    // 同一方法被查两次：先查状态/科室，成功后回读列表项；按 select 形状区分
    prisma.patient.findUnique.mockImplementation(
      (args: { select?: Record<string, unknown> } | undefined) =>
        Promise.resolve(args?.select?.nameMasked ? publicRow() : statusRow()),
    );
    prisma.virtualWardRecord.findFirst.mockResolvedValue(null);
    prisma.virtualWardRecord.create.mockResolvedValue({ id: 'w-1', joinedAt: JOINED_AT });
  });

  it('住院患者可加入：新建记录并回读更新后的列表项', async () => {
    const result = await service.join(deptUser, PATIENT_ID);

    expect(result.patientId).toBe(PATIENT_ID);
    expect(result.wardRecordId).toBe('w-1');
    expect(result.item.id).toBe(PATIENT_ID);
    const data = prisma.virtualWardRecord.create.mock.calls[0][0].data;
    expect(data).toEqual({ patientId: PATIENT_ID, joinedById: 'u-nurse' });
  });

  it('跨科室患者 → 30002，且不写库', async () => {
    prisma.patient.findUnique.mockResolvedValueOnce(statusRow({ departmentId: 'd-cardio' }));

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('设备管理员（NONE 档）→ 30006，且不写库', async () => {
    await expect(service.join(noneUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.NO_PATIENT_DATA_SCOPE,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('患者不存在按 40001 处理，不泄露存在性', async () => {
    prisma.patient.findUnique.mockResolvedValueOnce(null);

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('已归档患者按 40001 处理', async () => {
    prisma.patient.findUnique.mockResolvedValueOnce(
      statusRow({ archivedAt: new Date('2026-10-20T00:00:00.000Z') }),
    );

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('非住院患者（出院）→ 40004，仅住院可加入', async () => {
    prisma.patient.findUnique.mockResolvedValueOnce(
      statusRow({ status: PATIENT_STATUS.DISCHARGED }),
    );

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_INVALID_STATE,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('已在区 → 44001，不重复建记录', async () => {
    prisma.virtualWardRecord.findFirst.mockResolvedValue({ id: 'w-existing' });

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.WARD_ALREADY_JOINED,
    });
    expect(prisma.virtualWardRecord.create).not.toHaveBeenCalled();
  });

  it('并发绕过先查后判、撞部分唯一索引（P2002）→ 44001，不漏成 50000', async () => {
    prisma.virtualWardRecord.findFirst.mockResolvedValue(null);
    prisma.virtualWardRecord.create.mockRejectedValue(uniqueViolation());

    await expect(service.join(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.WARD_ALREADY_JOINED,
    });
  });
});

describe('WardService.leave — 移出虚拟病区', () => {
  let service: WardService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue(statusRow());
    prisma.virtualWardRecord.findFirst.mockResolvedValue({ id: 'w-1' });
    prisma.virtualWardRecord.updateMany.mockResolvedValue({ count: 1 });
  });

  it('在区患者可移出：原子更新 leftAt/leftById/leaveReason=MANUAL', async () => {
    const result = await service.leave(deptUser, PATIENT_ID);

    expect(result.patientId).toBe(PATIENT_ID);
    expect(result.wardRecordId).toBe('w-1');
    expect(result.leaveReason).toBe(WARD_LEAVE_REASON.MANUAL);
    const args = prisma.virtualWardRecord.updateMany.mock.calls[0][0];
    // where 带 leftAt:null 是并发兜底的关键：第二个人 count=0 → 44002
    expect(args.where).toEqual({ id: 'w-1', leftAt: null });
    expect(args.data.leftById).toBe('u-nurse');
    expect(args.data.leaveReason).toBe(WARD_LEAVE_REASON.MANUAL);
    expect(args.data.leftAt).toBeInstanceOf(Date);
  });

  it('出院患者也能被移出（不校验状态，为决策 8 自动移出复用同一路径）', async () => {
    prisma.patient.findUnique.mockResolvedValue(
      statusRow({ status: PATIENT_STATUS.DISCHARGED }),
    );

    const result = await service.leave(deptUser, PATIENT_ID);

    expect(result.leaveReason).toBe(WARD_LEAVE_REASON.MANUAL);
  });

  it('未在区 → 44002', async () => {
    prisma.virtualWardRecord.findFirst.mockResolvedValue(null);

    await expect(service.leave(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.WARD_NOT_JOINED,
    });
    expect(prisma.virtualWardRecord.updateMany).not.toHaveBeenCalled();
  });

  it('并发下 updateMany count=0 → 44002，不覆盖对方的移出时间', async () => {
    prisma.virtualWardRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.leave(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.WARD_NOT_JOINED,
    });
  });

  it('跨科室患者 → 30002，且不写库', async () => {
    prisma.patient.findUnique.mockResolvedValue(statusRow({ departmentId: 'd-cardio' }));

    await expect(service.leave(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.virtualWardRecord.updateMany).not.toHaveBeenCalled();
  });

  it('已归档患者按 40001 处理', async () => {
    prisma.patient.findUnique.mockResolvedValue(
      statusRow({ archivedAt: new Date('2026-10-20T00:00:00.000Z') }),
    );

    await expect(service.leave(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.virtualWardRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe('WardService.list — 当前/历史列表', () => {
  let service: WardService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.virtualWardRecord.findMany.mockResolvedValue([wardRow()]);
    prisma.virtualWardRecord.count.mockResolvedValue(1);
  });

  function findManyArgs() {
    return prisma.virtualWardRecord.findMany.mock.calls[0][0] as {
      where: Record<string, unknown> & { patient: Record<string, unknown> };
      orderBy: unknown;
      skip: number;
      take: number;
    };
  }

  it('CURRENT：只看在区行（leftAt=null），按 joinedAt desc, id asc 排序', async () => {
    const result = await service.list(deptUser, {
      tab: WARD_TAB.CURRENT,
      page: 1,
      pageSize: 20,
    } as WardListQuery);

    const args = findManyArgs();
    expect(args.where.leftAt).toBeNull();
    expect(args.orderBy).toEqual([{ joinedAt: 'desc' }, { id: 'asc' }]);
    expect(result.total).toBe(1);
    expect(result.items[0]?.wardRecordId).toBe('w-1');
  });

  it('HISTORY：只看已移出行（leftAt not null），按 leftAt desc, id asc 排序', async () => {
    await service.list(deptUser, {
      tab: WARD_TAB.HISTORY,
      page: 1,
      pageSize: 20,
    } as WardListQuery);

    const args = findManyArgs();
    expect(args.where.leftAt).toEqual({ not: null });
    expect(args.orderBy).toEqual([{ leftAt: 'desc' }, { id: 'asc' }]);
  });

  it('数据权限沿用患者域：DEPARTMENT 档把 scope 挂在 where.patient.departmentId', async () => {
    await service.list(deptUser, {
      tab: WARD_TAB.CURRENT,
      page: 1,
      pageSize: 20,
    } as WardListQuery);

    expect(findManyArgs().where.patient.departmentId).toBe('d-endo');
  });

  it('ALL 档不加科室限制（where.patient 不含 departmentId）', async () => {
    await service.list(allUser, {
      tab: WARD_TAB.CURRENT,
      page: 1,
      pageSize: 20,
    } as WardListQuery);

    expect(findManyArgs().where.patient).not.toHaveProperty('departmentId');
  });

  it('NONE 档（设备管理员）→ 30006，不发查询', async () => {
    await expect(
      service.list(noneUser, { tab: WARD_TAB.CURRENT, page: 1, pageSize: 20 } as WardListQuery),
    ).rejects.toMatchObject({ code: ERROR_CODES.NO_PATIENT_DATA_SCOPE });
    expect(prisma.virtualWardRecord.findMany).not.toHaveBeenCalled();
  });

  it('CURRENT 传了加入区间 → 落到 where.joinedAt 的 gte/lte', async () => {
    // dateTimeStringSchema 会把 'YYYY-MM-DD HH:mm:ss' 转成 Date，服务层拿到的已是 Date
    const joinFrom = new Date('2026-11-01T00:00:00.000Z');
    const joinTo = new Date('2026-11-30T23:59:59.000Z');
    await service.list(deptUser, {
      tab: WARD_TAB.CURRENT,
      joinFrom,
      joinTo,
      page: 1,
      pageSize: 20,
    } as WardListQuery);

    expect(findManyArgs().where.joinedAt).toEqual({ gte: joinFrom, lte: joinTo });
  });

  it('分页参数换算为 skip/take', async () => {
    await service.list(deptUser, {
      tab: WARD_TAB.CURRENT,
      page: 3,
      pageSize: 20,
    } as WardListQuery);

    const args = findManyArgs();
    expect(args.skip).toBe(40);
    expect(args.take).toBe(20);
  });
});
