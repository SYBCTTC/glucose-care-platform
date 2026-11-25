import { describe, expect, it } from 'vitest';
import {
  buildPrintFooter,
  formatPrintDate,
  formatPrintDay,
  formatPrintRangeFromDates,
  packUnitsIntoPages,
} from './paginate';

describe('packUnitsIntoPages — R28 打印分页装箱（裁定 D1 的计算部分）', () => {
  it('空输入 → 无页', () => {
    expect(packUnitsIntoPages([], 100)).toEqual([]);
  });

  it('全部放得下 → 单页，顺序不变', () => {
    expect(packUnitsIntoPages([30, 40, 20], 100)).toEqual([[0, 1, 2]]);
  });

  it('恰好装满（used == available）不换页，再放一个才换', () => {
    expect(packUnitsIntoPages([50, 50, 1], 100)).toEqual([[0, 1], [2]]);
  });

  it('超出可用高度 → 贪心切到下一页', () => {
    // 页高 100：60+30=90 放下；+20 超 → 换页；20+40=60 放下
    expect(packUnitsIntoPages([60, 30, 20, 40], 100)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('单元高于整页 → 独占一页（防御分支，不死循环）', () => {
    expect(packUnitsIntoPages([250, 10], 100)).toEqual([[0], [1]]);
  });

  it('每个单元都超页 → 每单元一页', () => {
    expect(packUnitsIntoPages([120, 130, 110], 100)).toEqual([[0], [1], [2]]);
  });
});

describe('formatPrintDate / formatPrintDay — 打印日期格式（裁定 B2）', () => {
  it('契约串 → YYYY年MM月DD日，丢弃时分秒', () => {
    expect(formatPrintDate('2026-11-25 13:45:09')).toBe('2026年11月25日');
  });

  it('空/undefined → "-"', () => {
    expect(formatPrintDate(null)).toBe('-');
    expect(formatPrintDate(undefined)).toBe('-');
    expect(formatPrintDate('')).toBe('-');
  });

  it('非法串 → "-"（防御，不输出 Invalid Date）', () => {
    expect(formatPrintDate('not-a-date')).toBe('-');
  });

  it('formatPrintDay 截到日（患者信息住院/出院日期用）', () => {
    expect(formatPrintDay('2026-11-25 13:45:09')).toBe('2026-11-25');
    expect(formatPrintDay(null)).toBe('-');
  });
});

describe('formatPrintRangeFromDates — 时间范围行（2026-11-25 变更裁定：依据数据不依据筛选）', () => {
  it('取数据最早/最晚测量日期，丢弃时分秒', () => {
    expect(
      formatPrintRangeFromDates([
        '2026-11-19 06:30:00',
        '2026-11-25 13:45:09',
        '2026-11-20 08:00:00',
      ]),
    ).toBe('时间：2026年11月19日~2026年11月25日');
  });

  it('输入乱序仍取 min/max（不依赖服务端排序）', () => {
    expect(formatPrintRangeFromDates(['2026-11-25', '2026-11-18', '2026-11-19'])).toBe(
      '时间：2026年11月18日~2026年11月25日',
    );
  });

  it('起止同日 → 单日期', () => {
    expect(formatPrintRangeFromDates(['2026-11-25 08:00:00', '2026-11-25 22:00:00'])).toBe(
      '时间：2026年11月25日',
    );
  });

  it('空数据 → "-"（防御，空数据时打印按钮本就禁用）', () => {
    expect(formatPrintRangeFromDates([])).toBe('时间：-');
  });
});

describe('buildPrintFooter — 页脚文案（裁定 Q3/Q4）', () => {
  it('第X/Y页 + 本页/总计条数', () => {
    expect(buildPrintFooter(0, 3, 12, 30)).toBe('第1/3页，本页12条数据，总计30条数据');
    expect(buildPrintFooter(2, 3, 6, 30)).toBe('第3/3页，本页6条数据，总计30条数据');
  });
});
