/**
 * 报表统计口径（R20）→ 公共统计栏 items 的适配测试。
 *
 * 迁移自原 `ReportStatsBar` 的 8 例：**口径一字未改**，只是断言从「渲染后的 HTML/文本」
 * 换成「适配产出的 items」——渲染层（20px 间距、gc-num、着色位置）已由
 * `GlucoseStatsBar.spec.tsx` 钉住，这里只管业务口径。
 *
 * 口径出处：docs/specs/glucose-report.md R20（2026-11-19 需求人四次调整裁定）。
 */
import { describe, expect, it } from 'vitest';
import type { DictItemOption, GlucoseReportStats } from '@gc/shared';
import { buildReportStatsItems } from './buildReportStatsItems';

/** 与 seed 一致的 DY-RESULT 片段。注意 '3' 的标签是 `Low`（血糖仪超下限），不是"未测" */
const RESULT_TYPES = [
  { code: '0', label: '偏低', color: '#4BB2ED', checkable: false, counted: true },
  { code: '1', label: '正常', color: '#389E0D', checkable: false, counted: true },
  { code: '2', label: '偏高', color: '#FF1516', checkable: false, counted: true },
  { code: '3', label: 'Low', color: '#4BB2ED', checkable: true, counted: true },
  { code: '4', label: 'High', color: '#FF1516', checkable: true, counted: true },
  { code: '5', label: '拒检', color: '#8C8C8C', checkable: true, counted: false },
] as unknown as DictItemOption[];

function stats(overrides: Partial<GlucoseReportStats> = {}): GlucoseReportStats {
  return {
    total: 17,
    qualified: 10,
    hasHigh: false,
    hasLow: false,
    maxValueMmolL: 9.8,
    maxResultType: '1',
    minValueMmolL: 5.2,
    minResultType: '1',
    ...overrides,
  };
}

function items(
  overrides: Partial<GlucoseReportStats> = {},
  resultTypes = RESULT_TYPES,
) {
  return buildReportStatsItems(stats(overrides), resultTypes);
}

describe('buildReportStatsItems — R20 统计口径适配', () => {
  it('恒产出四项，顺序与 label 固定：总计 / 合格次数 / 最高血糖 / 最低血糖', () => {
    expect(items().map((item) => item.label)).toEqual([
      '总计',
      '合格次数',
      '最高血糖',
      '最低血糖',
    ]);
  });

  it('总计与合格次数：值取服务端计数（与分页无关），后缀「 次」，等宽数字', () => {
    const [total, qualified] = items();

    expect(total).toEqual({ label: '总计', value: '17', suffix: ' 次', numeric: true });
    expect(qualified).toMatchObject({ label: '合格次数', value: '10', suffix: ' 次' });
  });

  it('合格次数带 divider：R20 视觉分组——总计与后三项之间用竖线断开', () => {
    const [total, qualified] = items();

    expect(qualified.divider).toBe(true);
    expect(total.divider).toBeUndefined();
  });

  it('最高血糖（无 High）：toFixed(1) + 「 mmol/L」，色取该极值自身 resultType 的字典色', () => {
    const [, , max] = items({ maxValueMmolL: 12.34, maxResultType: '2' });

    expect(max).toEqual({
      label: '最高血糖',
      value: '12.3',
      suffix: ' mmol/L',
      color: '#FF1516', // '2' 偏高的字典色
      numeric: true,
    });
  });

  it('最低血糖（无 Low）：同口径，颜色取自身 resultType', () => {
    const [, , , min] = items({ minValueMmolL: 3.2, minResultType: '0' });

    expect(min).toEqual({
      label: '最低血糖',
      value: '3.2',
      suffix: ' mmol/L',
      color: '#4BB2ED', // '0' 偏低的字典色
      numeric: true,
    });
  });

  it('hasHigh → 展示字典 label「High」及其色，不再展示数值（裁定 3）', () => {
    const [, , max] = items({ hasHigh: true, maxValueMmolL: 12.3, maxResultType: '2' });

    expect(max).toEqual({
      label: '最高血糖',
      value: 'High',
      color: '#FF1516', // '4' High 的字典色，而非 '2' 的
      numeric: false,
    });
    expect(max.value).not.toContain('12.3');
  });

  it('hasLow → 展示字典 label「Low」及其色，不再展示数值', () => {
    const [, , , min] = items({ hasLow: true, minValueMmolL: 5.2, minResultType: '1' });

    expect(min).toEqual({
      label: '最低血糖',
      value: 'Low',
      color: '#4BB2ED', // '3' Low 的字典色
      numeric: false,
    });
  });

  it('无数值记录且无 High/Low → 极值为 -（裁定 3a：总计为 0 时四项照常产出）', () => {
    const result = items({
      total: 0,
      qualified: 0,
      maxValueMmolL: null,
      maxResultType: null,
      minValueMmolL: null,
      minResultType: null,
    });

    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ value: '0' });
    expect(result[1]).toMatchObject({ value: '0' });
    expect(result[2]).toEqual({ label: '最高血糖', value: '-', numeric: false });
    expect(result[3]).toEqual({ label: '最低血糖', value: '-', numeric: false });
  });

  it('字典未加载时不崩：High/Low 回退 code 原文、不着色（同 ReportCell 口径，不硬编码文案）', () => {
    const [, , max, min] = items({ hasHigh: true, hasLow: true }, []);

    expect(max).toEqual({ label: '最高血糖', value: '4', color: undefined, numeric: false });
    expect(min).toEqual({ label: '最低血糖', value: '3', color: undefined, numeric: false });
  });

  it('字典未加载且为数值极值：数值照常展示、只是不着色', () => {
    const [, , max] = items({ maxValueMmolL: 9.8, maxResultType: '1' }, []);

    expect(max).toMatchObject({ value: '9.8', suffix: ' mmol/L', numeric: true });
    expect(max.color).toBeUndefined();
  });
});
