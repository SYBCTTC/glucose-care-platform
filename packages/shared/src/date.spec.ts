import { describe, expect, it } from 'vitest';
import {
  dateOnlyStringSchema,
  formatDateOnly,
  formatDateTime,
  formatLocalDate,
  formatLocalTime,
  parseLocalDate,
} from './date';

/**
 * 本文件的核心目的不是覆盖率，而是**钉死两套日期口径的分工**：
 *
 *  - UTC 口径（`formatDateOnly` / `dateOnlyStringSchema`）→ 服务 `@db.Date` 列，如出生日期；
 *  - 本地口径（`formatLocalDate` / `formatLocalTime` / `parseLocalDate`）→ 服务 `timestamptz` 列，
 *    如 `GlucoseRecord.measuredAt`。
 *
 * 选错不会报错，只会**静默错一天 / 偏 8 小时**。血糖报表按本地日历日分组，
 * 若误用 UTC 版本，北京时间 00:00–08:00 的记录会被归到前一天——那是进病历的医疗数据错误。
 * 故下面的断言刻意写成**时区无关**（用 `getTimezoneOffset()` 推导期望值），
 * 但在本项目约定的 Asia/Shanghai（offset=+480）下，两套口径必然产生不同结果。
 */

/** 运行环境相对 UTC 的偏移分钟数；Asia/Shanghai 为 480 */
const OFFSET_MINUTES = -new Date(2026, 10, 19).getTimezoneOffset();

describe('formatLocalDate / formatLocalTime — 本地口径出参', () => {
  it('按本地时区取日期与时分', () => {
    const local = new Date(2026, 10, 19, 8, 5);

    expect(formatLocalDate(local)).toBe('2026-11-19');
    expect(formatLocalTime(local)).toBe('08:05');
  });

  it('空值返回 null', () => {
    expect(formatLocalDate(null)).toBeNull();
    expect(formatLocalDate(undefined)).toBeNull();
    expect(formatLocalTime(null)).toBeNull();
    expect(formatLocalTime(undefined)).toBeNull();
  });

  it('本地 00:30 与 formatDateOnly（UTC）在东时区跨日：结果必须不同', () => {
    // 本地 2026-11-19 00:30；东时区下对应 UTC 2026-11-18 16:30
    const local = new Date(2026, 10, 19, 0, 30);

    expect(formatLocalDate(local)).toBe('2026-11-19');
    expect(formatDateOnly(local)).toBe(OFFSET_MINUTES > 0 ? '2026-11-18' : '2026-11-19');

    // 本项目跑在 Asia/Shanghai，这条断言必然生效——即"误用 UTC 版本会错一天"的实证
    if (OFFSET_MINUTES > 0) {
      expect(formatDateOnly(local)).not.toBe(formatLocalDate(local));
    }
  });

  it('与 formatDateTime 同为本地口径：日期与时分部分一致', () => {
    const local = new Date(2026, 10, 19, 23, 59, 30);

    expect(formatDateTime(local)).toBe('2026-11-19 23:59:30');
    expect(formatLocalDate(local)).toBe('2026-11-19');
    expect(formatLocalTime(local)).toBe('23:59');
  });
});

describe('parseLocalDate — 本地口径入参', () => {
  it('YYYY-MM-DD 解析为本地零点，可被 formatLocalDate 无损回环', () => {
    const date = parseLocalDate('2026-11-19');

    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(10);
    expect(date?.getDate()).toBe(19);
    expect(date?.getHours()).toBe(0);
    expect(date?.getMinutes()).toBe(0);
    expect(date?.getSeconds()).toBe(0);
    expect(formatLocalDate(date)).toBe('2026-11-19');
  });

  it('本地零点 ≠ UTC 零点：与 dateOnlyStringSchema 恰好差一个时区偏移', () => {
    const local = parseLocalDate('2026-11-19');
    const utc = dateOnlyStringSchema.parse('2026-11-19');

    expect(local).not.toBeNull();
    // 东时区下**本地零点早于 UTC 零点**，故差值为负：Asia/Shanghai 为 -8h
    expect(Number(local) - Number(utc)).toBe(-OFFSET_MINUTES * 60_000);
    // 这 8 小时就是"范围过滤用错口径会漏一整天"的来源：
    // 用 UTC 零点当本地日起点，会把本地 00:00–08:00 的记录划到范围之外
    if (OFFSET_MINUTES > 0) {
      expect(formatDateOnly(local)).toBe('2026-11-18');
    }
  });

  it('容忍首尾空格', () => {
    expect(formatLocalDate(parseLocalDate('  2026-11-19  '))).toBe('2026-11-19');
  });

  it('格式非法返回 null', () => {
    expect(parseLocalDate('2026-11-19 08:00')).toBeNull();
    expect(parseLocalDate('2026/11/19')).toBeNull();
    expect(parseLocalDate('20261119')).toBeNull();
    expect(parseLocalDate('26-11-19')).toBeNull();
    expect(parseLocalDate('abc')).toBeNull();
  });

  it('日期不存在返回 null（回环校验拦下 Date 的自动进位）', () => {
    // new Date(2026, 1, 30) 会进位成 3-02；new Date(2026, 12, 1) 会进位成 2027-01-01
    expect(parseLocalDate('2026-02-30')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('2026-00-10')).toBeNull();
    // 闰年合法日期不受影响
    expect(formatLocalDate(parseLocalDate('2024-02-29'))).toBe('2024-02-29');
    expect(parseLocalDate('2026-02-29')).toBeNull();
  });

  it('空值返回 null', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('   ')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
  });
});
