import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { formatHospitalDays, formatWardDays } from './patient-format';

/**
 * 加入虚拟病区天数的口径回归。
 *
 * 关键不变量：`formatWardDays` 必须与 `formatHospitalDays` **完全一致**
 * （加入当天算 1 天、最小 1 天、以 startOf('day') 取整日差）。两个函数刻意放在一起，
 * 因为同一张卡片上会并排显示「住院天数」和「加入虚拟病区天数」，规则不同会被当成 bug。
 * 历史行（leftAt 非空）以移出时间为终点，显示"曾在区多久"而不是"至今"。
 */
describe('formatWardDays — 加入虚拟病区天数', () => {
  it('joinedAt 为空 → "-"', () => {
    expect(formatWardDays('', null)).toBe('-');
  });

  it('加入当天即移出 → 1 天（最小 1 天）', () => {
    expect(formatWardDays('2026-11-18 08:00:00', '2026-11-18 20:00:00')).toBe('1 天');
  });

  it('历史行以移出时间为终点：11-01 → 11-18 共 18 天', () => {
    expect(formatWardDays('2026-11-01 08:00:00', '2026-11-18 09:00:00')).toBe('18 天');
  });

  it('跨年：2025-12-30 → 2026-01-02 共 4 天', () => {
    expect(formatWardDays('2025-12-30 10:00:00', '2026-01-02 06:00:00')).toBe('4 天');
  });

  it('在区行（leftAt=null）以当前时间为终点：今天加入 → 1 天', () => {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    expect(formatWardDays(now, null)).toBe('1 天');
  });

  it('移出时间早于加入时间（异常数据）→ 兜底 1 天，不出现 0 或负数', () => {
    expect(formatWardDays('2026-11-18 08:00:00', '2026-11-10 08:00:00')).toBe('1 天');
  });

  it('口径与 formatHospitalDays 完全一致', () => {
    for (const [joined, left] of [
      ['2026-11-01 08:00:00', '2026-11-18 09:00:00'],
      ['2026-11-18 08:00:00', '2026-11-18 20:00:00'],
      ['2025-12-30 10:00:00', '2026-01-02 06:00:00'],
    ] as const) {
      expect(formatWardDays(joined, left)).toBe(formatHospitalDays(joined, left));
    }
    // leftAt=null 与 dischargeAt=null 都走"至今"，两者仍须一致（同一 now，与时区无关）
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    expect(formatWardDays(now, null)).toBe(formatHospitalDays(now, null));
  });
});
