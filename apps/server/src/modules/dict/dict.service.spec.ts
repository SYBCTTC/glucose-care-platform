import { DICT_TYPE, dictTypeParamSchema } from '@gc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { DictService } from './dict.service';

/** 本科室数据范围的护士：字典是全院基础数据，不应被数据范围收窄 */
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

/** 无患者数据范围的角色（设备管理员），同样应能读字典 */
const noneUser = { ...deptUser, dataScope: 'NONE' } as unknown as AuthenticatedUser;

function createService() {
  const prisma = { dictItem: { findMany: vi.fn().mockResolvedValue([]) } };
  return { prisma, service: new DictService(prisma as unknown as PrismaService) };
}

describe('DictService.list — 动态字典读取', () => {
  let service: DictService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
  });

  it('只取本字典类型的启用项，并按 sortOrder、code 升序', async () => {
    await service.list(deptUser, DICT_TYPE.GLUCOSE_RESULT);

    const args = prisma.dictItem.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ dictType: DICT_TYPE.GLUCOSE_RESULT, enabled: true });
    expect(args.orderBy).toEqual([{ sortOrder: 'asc' }, { code: 'asc' }]);
  });

  it('只下发展示所需字段，不把主键/时间戳等内部字段透给前端', async () => {
    await service.list(deptUser, DICT_TYPE.GLUCOSE_RESULT);

    const args = prisma.dictItem.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      code: true,
      label: true,
      color: true,
      checkable: true,
      counted: true,
      sortOrder: true,
    });
  });

  it('字典是全院基础数据：本科室与无患者数据范围的角色都不加科室条件', async () => {
    await service.list(deptUser, DICT_TYPE.GLUCOSE_RESULT);
    await service.list(noneUser, DICT_TYPE.GLUCOSE_RESULT);

    for (const call of prisma.dictItem.findMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('departmentId');
    }
  });
});

describe('dictTypeParamSchema — 字典类型白名单', () => {
  it('已登记类型通过校验', () => {
    expect(dictTypeParamSchema.safeParse({ dictType: DICT_TYPE.GLUCOSE_RESULT }).success).toBe(true);
  });

  it('未登记类型被拦下，避免随便拼 dictType 探测数据', () => {
    expect(dictTypeParamSchema.safeParse({ dictType: 'UNKNOWN' }).success).toBe(false);
  });
});
