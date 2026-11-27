import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { resolveAlertTimeRange, TIME_PRESET_LABELS, TIME_PRESETS } from './alert-time';

/**
 * 预警筛选时间预设的**口径层**测试（P4-7 规格 §4 规则 3，裁定 R1-Q3 / R1-Q4）。
 *
 * ⚠️ 混合口径是需求原文＋裁定的结果：近一月=固定 30 天，近三月起=日历同日回推
 * （dayjs 月减法在目标日不存在时自动收敛到月末）。本文件钉住该口径不被"统一"掉。
 */

/** 固定"当前时刻"便于断言（注入 now，纯函数可测） */
const NOW = dayjs('2026-11-27 09:16:00');

describe('resolveAlertTimeRange — 时间预设口径', () => {
  it('本月：当月 1 日 00:00:00 ~ 当前时刻', () => {
    expect(resolveAlertTimeRange('thisMonth', null, NOW)).toEqual({
      startTime: '2026-11-01 00:00:00',
      endTime: '2026-11-27 09:16:00',
    });
  });

  it('近一月：往前固定 30 天当日零点（需求原文明确天数，不是自然月）', () => {
    expect(resolveAlertTimeRange('last1m', null, NOW)).toEqual({
      startTime: '2026-10-28 00:00:00',
      endTime: '2026-11-27 09:16:00',
    });
  });

  it('近三月/近半年/近一年：日历同日回推零点（裁定 R1-Q3）', () => {
    expect(resolveAlertTimeRange('last3m', null, NOW).startTime).toBe('2026-08-27 00:00:00');
    expect(resolveAlertTimeRange('last6m', null, NOW).startTime).toBe('2026-05-27 00:00:00');
    expect(resolveAlertTimeRange('last1y', null, NOW).startTime).toBe('2025-11-27 00:00:00');
  });

  it('月末回推目标日不存在 → 收敛到月末（2027-05-31 回推 3 月 → 02-28）', () => {
    const monthEnd = dayjs('2027-05-31 12:00:00');

    expect(resolveAlertTimeRange('last3m', null, monthEnd).startTime).toBe('2027-02-28 00:00:00');
  });

  it('预设口径的结束时间恒为当前时刻（非当日 23:59:59）', () => {
    for (const preset of ['thisMonth', 'last1m', 'last3m', 'last6m', 'last1y'] as const) {
      expect(resolveAlertTimeRange(preset, null, NOW).endTime).toBe('2026-11-27 09:16:00');
    }
  });

  it('自选区间：开始日 00:00:00 ~ 结束日 23:59:59（裁定 R1-Q4，含结束日全天）', () => {
    const range: [dayjs.Dayjs, dayjs.Dayjs] = [
      dayjs('2026-11-01 15:30:42'),
      dayjs('2026-11-20 08:00:00'),
    ];

    expect(resolveAlertTimeRange('custom', range, NOW)).toEqual({
      startTime: '2026-11-01 00:00:00',
      endTime: '2026-11-20 23:59:59',
    });
  });

  it('自选但未选区间：回退本月（防御性兜底，正常由 UI 保证查询前已选）', () => {
    expect(resolveAlertTimeRange('custom', null, NOW)).toEqual({
      startTime: '2026-11-01 00:00:00',
      endTime: '2026-11-27 09:16:00',
    });
  });
});

describe('TIME_PRESETS / TIME_PRESET_LABELS — 下拉契约', () => {
  it('六个预设齐全且顺序即下拉展示顺序', () => {
    expect(TIME_PRESETS).toEqual(['thisMonth', 'last1m', 'last3m', 'last6m', 'last1y', 'custom']);
  });

  it('文案与需求原文一致', () => {
    expect(TIME_PRESET_LABELS).toEqual({
      thisMonth: '本月',
      last1m: '近一月',
      last3m: '近三月',
      last6m: '近半年',
      last1y: '近一年',
      custom: '自选时间区间',
    });
  });
});
