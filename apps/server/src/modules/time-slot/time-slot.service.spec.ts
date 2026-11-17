import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { TimeSlotService } from './time-slot.service';

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

/** 无患者数据范围的角色（设备管理员），同样应能读时段 */
const noneUser = { ...deptUser, dataScope: 'NONE' } as unknown as AuthenticatedUser;

function row(overrides: Record<string, unknown> = {}) {
  return {
    code: 'BREAKFAST_POST',
    name: '早餐后',
    type: 1,
    startTime: '08:00',
    endTime: '11:00',
    valueDown: new Prisma.Decimal('4.4'),
    valueUp: new Prisma.Decimal('10.0'),
    sortOrder: 30,
    enabled: true,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    timeSlot: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  return { prisma, service: new TimeSlotService(prisma as unknown as PrismaService) };
}

describe('TimeSlotService.list — 时段公共数据', () => {
  let service: TimeSlotService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
  });

  it('按 sortOrder、code 升序，不再在服务端按 type 分组', async () => {
    await service.list(deptUser);

    const args = prisma.timeSlot.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { code: 'asc' }]);
  });

  it('停用项也要下发：历史血糖仍需按 code 展示名称', async () => {
    await service.list(deptUser);

    const args = prisma.timeSlot.findMany.mock.calls[0][0];
    expect(args.where).not.toHaveProperty('enabled');
    expect(args.select).toMatchObject({ enabled: true });
  });

  it('timeScope 由起止时间派生，不落库', async () => {
    prisma.timeSlot.findMany.mockResolvedValue([row()]);

    const [item] = await service.list(deptUser);
    expect(item.timeScope).toBe('08:00-11:00');
  });

  it('特殊/强化时段无区间：timeScope 为 null', async () => {
    prisma.timeSlot.findMany.mockResolvedValue([
      row({ code: 'RANDOM', name: '随机', type: 4, startTime: null, endTime: null, valueDown: null, valueUp: null }),
    ]);

    const [item] = await service.list(deptUser);
    expect(item.startTime).toBeNull();
    expect(item.endTime).toBeNull();
    expect(item.timeScope).toBeNull();
    expect(item.valueDown).toBeNull();
    expect(item.valueUp).toBeNull();
  });

  it('Decimal 转为 number 下发，避免 JSON 里出现字符串或对象', async () => {
    prisma.timeSlot.findMany.mockResolvedValue([row()]);

    const [item] = await service.list(deptUser);
    expect(item.valueDown).toBe(4.4);
    expect(item.valueUp).toBe(10);
  });

  it('时段是全院基础数据：本科室与无患者数据范围的角色都不加科室条件', async () => {
    await service.list(deptUser);
    await service.list(noneUser);

    for (const call of prisma.timeSlot.findMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('departmentId');
    }
  });
});

describe('TimeSlotService.findByCode — 录入前的时段可用性校验', () => {
  let service: TimeSlotService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
  });

  it('按 code 精确查询，只取校验需要的两列', async () => {
    await service.findByCode(deptUser, 'FASTING');

    expect(prisma.timeSlot.findFirst).toHaveBeenCalledWith({
      where: { code: 'FASTING' },
      select: { code: true, enabled: true },
    });
  });

  it('停用项也要查出来：由调用方区分「不存在」与「已停用」', async () => {
    prisma.timeSlot.findFirst.mockResolvedValue({ code: 'FASTING', enabled: false });

    expect(await service.findByCode(deptUser, 'FASTING')).toEqual({
      code: 'FASTING',
      enabled: false,
    });
  });

  it('code 不存在返回 null', async () => {
    prisma.timeSlot.findFirst.mockResolvedValue(null);

    expect(await service.findByCode(deptUser, 'NOPE')).toBeNull();
  });

  it('时段是全院基础数据：无患者数据范围的角色同样可查', async () => {
    await service.findByCode(noneUser, 'FASTING');

    expect(prisma.timeSlot.findFirst.mock.calls[0][0].where).not.toHaveProperty('departmentId');
  });
});
