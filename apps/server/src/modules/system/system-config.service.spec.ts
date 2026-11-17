import { ERROR_CODES } from '@gc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { SYSTEM_CONFIG_KEY, SystemConfigService } from './system-config.service';

/**
 * 系统参数读取。
 *
 * 重点回归：阈值缺失/非法时必须抛错，**不得退回默认常量**——
 * 血糖判定结果直接进病历，按错误阈值静默分类比拒绝写入危险得多。
 */

const LOW = SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD;
const HIGH = SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD;

function createService(rows: Array<{ key: string; value: string }>) {
  const prisma = { systemConfig: { findMany: vi.fn().mockResolvedValue(rows) } };
  return {
    prisma,
    service: new SystemConfigService(prisma as unknown as PrismaService),
  };
}

describe('SystemConfigService.getGlucoseAlertThreshold', () => {
  let service: SystemConfigService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService([
      { key: LOW, value: '3.9' },
      { key: HIGH, value: '16.7' },
    ]));
  });

  it('正常读取 seed 的默认阈值', async () => {
    await expect(service.getGlucoseAlertThreshold()).resolves.toEqual({ low: 3.9, high: 16.7 });
  });

  it('只查两个阈值键，不整表扫描', async () => {
    await service.getGlucoseAlertThreshold();

    expect(prisma.systemConfig.findMany).toHaveBeenCalledWith({
      where: { key: { in: [LOW, HIGH] } },
      select: { key: true, value: true },
    });
  });

  it('阈值改动即时生效（不做缓存，避免"改了配置不生效"）', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: LOW, value: '4.4' },
      { key: HIGH, value: '11.1' },
    ]);

    await expect(service.getGlucoseAlertThreshold()).resolves.toEqual({ low: 4.4, high: 11.1 });
  });

  it.each([
    ['低阈值缺失', [{ key: HIGH, value: '16.7' }]],
    ['高阈值缺失', [{ key: LOW, value: '3.9' }]],
    ['两个都缺失', []],
  ])('%s → 10000', async (_label, rows) => {
    prisma.systemConfig.findMany.mockResolvedValue(rows);

    await expect(service.getGlucoseAlertThreshold()).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });

  it.each([
    ['空字符串', ''],
    ['纯空白', '   '],
    ['非数字', 'abc'],
    ['带单位的字符串', '3.9mmol/L'],
  ])('低阈值为%s → 10000', async (_label, value) => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: LOW, value },
      { key: HIGH, value: '16.7' },
    ]);

    await expect(service.getGlucoseAlertThreshold()).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });

  it.each([
    ['低于仪器可测下限', '0.1'],
    ['高于仪器可测上限', '40'],
    ['负数', '-3.9'],
  ])('低阈值%s（%s）→ 10000', async (_label, value) => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: LOW, value },
      { key: HIGH, value: '16.7' },
    ]);

    await expect(service.getGlucoseAlertThreshold()).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });

  it.each([
    ['低阈值大于高阈值', '20.0', '16.7'],
    ['两者相等', '16.7', '16.7'],
  ])('%s → 10000（判定区间会塌缩）', async (_label, low, high) => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: LOW, value: low },
      { key: HIGH, value: high },
    ]);

    await expect(service.getGlucoseAlertThreshold()).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  });

  it('边界值合法：低阈值可取 0.6、高阈值可取 33.3', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([
      { key: LOW, value: '0.6' },
      { key: HIGH, value: '33.3' },
    ]);

    await expect(service.getGlucoseAlertThreshold()).resolves.toEqual({ low: 0.6, high: 33.3 });
  });

  it('数据库异常原样抛出，不包装成 10000 掩盖故障', async () => {
    const dbError = new Error('connection closed');
    prisma.systemConfig.findMany.mockRejectedValue(dbError);

    await expect(service.getGlucoseAlertThreshold()).rejects.toBe(dbError);
  });
});
