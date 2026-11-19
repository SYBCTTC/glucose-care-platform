/**
 * 血糖报告**单元格**渲染测试。
 *
 * 只测 `ReportCell`：它是 R3/R4 渲染口径的验收主体（两行结构、半角括号、强化后缀、
 * 字典标签回退、多条堆叠），而外层 `GlucoseReportTab` 依赖 Outlet context 与网络请求，
 * 在 node 测试环境（无 jsdom）里跑不起来，靠 typecheck + 手工 e2e 验证。
 *
 * `ReportCell` 的字典走 **prop** 而非 store，正是为了可测：web 测试用 `renderToStaticMarkup`，
 * 而 zustand v5 的服务端快照返回**初始** state，测试里 `setState` 塞进去的字典读不到。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DictItemOption, GlucoseReportCell, GlucoseReportEntry } from '@gc/shared';
import { ReportCell } from './GlucoseReportTab';

/** 与 seed 一致的 DY-RESULT 片段。注意 '3' 的标签是 `Low`（血糖仪超下限），不是"未测" */
const RESULT_TYPES = [
  { code: '0', label: '偏低', color: '#4BB2ED', checkable: false, counted: true },
  { code: '1', label: '正常', color: '#389E0D', checkable: false, counted: true },
  { code: '2', label: '偏高', color: '#FF1516', checkable: false, counted: true },
  { code: '3', label: 'Low', color: '#4BB2ED', checkable: true, counted: true },
  { code: '5', label: '拒检', color: '#8C8C8C', checkable: true, counted: false },
] as unknown as DictItemOption[];

function entry(overrides: Partial<GlucoseReportEntry> = {}): GlucoseReportEntry {
  return {
    valueMmolL: 6.8,
    resultType: '1',
    time: '08:30',
    nurseName: '李护士',
    intensiveName: null,
    ...overrides,
  };
}

function render(entries: GlucoseReportEntry[], resultTypes = RESULT_TYPES): string {
  const cell: GlucoseReportCell = { slotCode: 'BREAKFAST_POST', entries };
  return renderToStaticMarkup(<ReportCell cell={cell} resultTypes={resultTypes} />);
}

/**
 * 取渲染后的**可见文本**。
 * R3 要求的「紧邻无空格」是视觉口径：值与时间分处两个 span（为了只给值染色），
 * markup 里被标签隔开是正常的，断言必须落在去标签后的文本上。
 */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

describe('ReportCell — 血糖报告单元格（R3/R4）', () => {
  it('两行结构：第 1 行 值(HH:mm)，第 2 行 记录者', () => {
    const html = render([entry()]);

    expect(textOf(html)).toContain('6.8(08:30)');
    expect(textOf(html)).toContain('李护士');
  });

  it('括号一律英文半角、紧邻无空格', () => {
    const text = textOf(render([entry({ intensiveName: '强化-上午' })]));

    expect(text).not.toContain('（');
    expect(text).not.toContain('）');
    expect(text).not.toContain('6.8 (');
    expect(text).not.toContain(') (');
    expect(text).not.toContain('( ');
  });

  it('强化时段：时间后再追加一个半角括号包裹的强化时段名（R3 变更后的位置）', () => {
    expect(textOf(render([entry({ intensiveName: '强化-上午' })]))).toContain(
      '6.8(08:30)(强化-上午)',
    );
  });

  it('非强化记录不出现第二个括号', () => {
    expect(textOf(render([entry()]))).not.toContain('(08:30)(');
  });

  it('有强化时段：`值(时间)` 与 `(强化名)` 之间 6px 间距，值与时间之间无间距（2026-11-19 三次调整）', () => {
    const html = render([entry({ intensiveName: '强化-上午' })]);

    expect(html).toContain('<span style="margin-left:6px">(强化-上午)</span>');
    expect(html).toContain('<span>(08:30)</span>');
  });

  it('无强化时段：`值` 与 `(时间)` 之间 6px 间距（2026-11-19 三次调整）', () => {
    const html = render([entry()]);

    expect(html).toContain('<span style="margin-left:6px">(08:30)</span>');
    expect(html).not.toContain('<span>(08:30)</span>');
  });

  it('valueMmolL 为 null → 显示字典标签而非数值（R8）', () => {
    const text = textOf(render([entry({ valueMmolL: null, resultType: '3' })]));

    expect(text).toContain('Low(08:30)');
    expect(text).not.toContain('6.8');
  });

  it('字典查不到的 resultType 回退显示 code 原文（同 LastGlucose 口径）', () => {
    expect(textOf(render([entry({ valueMmolL: null, resultType: '99' })]))).toContain('99(08:30)');
  });

  it('血糖值保留一位小数', () => {
    expect(textOf(render([entry({ valueMmolL: 7 })]))).toContain('7.0(08:30)');
    expect(textOf(render([entry({ valueMmolL: 12.34 })]))).toContain('12.3(08:30)');
  });

  it('nurseName 为 null → 第 2 行显示 -（D7）', () => {
    const text = textOf(render([entry({ nurseName: null })]));

    expect(text).toContain('-');
    expect(text).not.toContain('李护士');
  });

  it('同日同时段多条 → 纵向堆叠，每条都是完整两行，组间有分隔线（R4）', () => {
    const html = render([
      entry({ time: '08:30' }),
      entry({ time: '09:15', valueMmolL: 7.2, nurseName: '王护士' }),
    ]);

    expect(textOf(html)).toContain('6.8(08:30)李护士');
    expect(textOf(html)).toContain('7.2(09:15)王护士');
    // 第二条起带 borderTop 分隔线
    expect(html).toContain('border-top');
  });

  it('着色只作用于值/标签：字典色只出现一次，时间与记录者不染告警色（D4）', () => {
    const html = render([entry({ resultType: '2', intensiveName: '强化-上午' })]);

    expect(html.split('#FF1516').length - 1).toBe(1);
  });

  it('字典未加载时不崩：值照常显示、只是不着色', () => {
    const text = textOf(render([entry({ valueMmolL: null, resultType: '3' })], []));

    expect(text).toContain('3(08:30)');
  });

  it('空单元格渲染为空，不展示任何内容（2026-11-19 二次调整，替代原 - 占位）', () => {
    expect(render([])).toBe('');
  });

  it('cell 为 undefined（列与数据不匹配）时不抛异常且渲染为空', () => {
    expect(renderToStaticMarkup(<ReportCell cell={undefined} resultTypes={RESULT_TYPES} />)).toBe(
      '',
    );
  });
});
