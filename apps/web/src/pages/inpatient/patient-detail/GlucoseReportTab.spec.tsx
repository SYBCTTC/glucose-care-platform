/**
 * 血糖报告**单元格**渲染与 R22 展示过滤测试。
 *
 * 只测纯函数/纯组件：`ReportCell` 是 R3/R4/R22 渲染口径的验收主体（两行结构、半角括号、
 * 来源时段名后缀、字典标签回退、多条堆叠、时间/操作人勾选），`filterReportRows` 是
 * R22 记录级过滤（常规/强化显隐、特殊恒展示、空行保留）的验收主体；
 * 外层 `GlucoseReportTab` 依赖 Outlet context 与网络请求，
 * 在 node 测试环境（无 jsdom）里跑不起来，靠 typecheck + 手工 e2e 验证。
 *
 * `ReportCell` 的字典走 **prop** 而非 store，正是为了可测：web 测试用 `renderToStaticMarkup`，
 * 而 zustand v5 的服务端快照返回**初始** state，测试里 `setState` 塞进去的字典读不到。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TIME_SLOT_CATEGORY } from '@gc/shared';
import type {
  DictItemOption,
  GlucoseReportCell,
  GlucoseReportEntry,
  GlucoseReportRow,
} from '@gc/shared';
import { DEFAULT_GLUCOSE_REPORT_DISPLAY, type GlucoseReportDisplay } from './detail-tabs';
import dayjs from 'dayjs';
import { buildAddPrefill, filterReportRows, ReportCell } from './GlucoseReportTab';

/** 与 seed 一致的 DY-RESULT 片段。注意 '3' 的标签是 `Low`（血糖仪超下限），不是"未测" */
const RESULT_TYPES = [
  { code: '0', label: '偏低', color: '#4BB2ED', checkable: false, counted: true },
  { code: '1', label: '正常', color: '#389E0D', checkable: false, counted: true },
  { code: '2', label: '偏高', color: '#FF1516', checkable: false, counted: true },
  { code: '3', label: 'Low', color: '#4BB2ED', checkable: true, counted: true },
  { code: '4', label: 'High', color: '#FF1516', checkable: true, counted: true },
  { code: '5', label: '拒检', color: '#8C8C8C', checkable: true, counted: false },
] as unknown as DictItemOption[];

function entry(overrides: Partial<GlucoseReportEntry> = {}): GlucoseReportEntry {
  return {
    id: 'g-1',
    valueMmolL: 6.8,
    resultType: '1',
    time: '08:30',
    nurseName: '李护士',
    // R22：默认按"启用的普通时段记录"造数；强化/特殊/弃用来源用 overrides 覆盖
    sourceType: TIME_SLOT_CATEGORY.NORMAL,
    sourceSlotName: null,
    ...overrides,
  };
}

function render(
  entries: GlucoseReportEntry[],
  resultTypes = RESULT_TYPES,
  display: GlucoseReportDisplay = DEFAULT_GLUCOSE_REPORT_DISPLAY,
): string {
  const cell: GlucoseReportCell = { slotCode: 'BREAKFAST_POST', entries };
  return renderToStaticMarkup(
    <ReportCell cell={cell} resultTypes={resultTypes} display={display} />,
  );
}

/** 展示勾选的部分覆盖（未指定的项保持默认勾选） */
function display(overrides: Partial<GlucoseReportDisplay>): GlucoseReportDisplay {
  return { ...DEFAULT_GLUCOSE_REPORT_DISPLAY, ...overrides };
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
    const text = textOf(
      render([entry({ sourceType: TIME_SLOT_CATEGORY.INTENSIVE, sourceSlotName: '强化-上午' })]),
    );

    expect(text).not.toContain('（');
    expect(text).not.toContain('）');
    expect(text).not.toContain('6.8 (');
    expect(text).not.toContain(') (');
    expect(text).not.toContain('( ');
  });

  it('强化时段：时间后再追加一个半角括号包裹的强化时段名（R3 变更后的位置）', () => {
    expect(
      textOf(
        render([entry({ sourceType: TIME_SLOT_CATEGORY.INTENSIVE, sourceSlotName: '强化-上午' })]),
      ),
    ).toContain('6.8(08:30)(强化-上午)');
  });

  it('非强化记录不出现第二个括号', () => {
    expect(textOf(render([entry()]))).not.toContain('(08:30)(');
  });

  it('有强化时段：三段由 flex columnGap 各留 6px 间距，三段均 nowrap 不可拆（2026-11-25 变更）', () => {
    const html = render([
      entry({ sourceType: TIME_SLOT_CATEGORY.INTENSIVE, sourceSlotName: '强化-上午' }),
    ]);

    expect(html).toContain('display:flex;flex-wrap:wrap;justify-content:center;column-gap:6px');
    expect(html).toContain('<span style="white-space:nowrap">(08:30)</span>');
    expect(html).toContain('<span style="white-space:nowrap">(强化-上午)</span>');
  });

  it('无强化时段：`值` 与 `(时间)` 之间 6px 间距（columnGap，2026-11-25 变更）', () => {
    const html = render([entry()]);

    expect(html).toContain('<span style="white-space:nowrap">(08:30)</span>');
    expect(html).toContain('column-gap:6px');
    expect(html).not.toContain('强化');
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
    const html = render([
      entry({
        resultType: '2',
        sourceType: TIME_SLOT_CATEGORY.INTENSIVE,
        sourceSlotName: '强化-上午',
      }),
    ]);

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
    expect(
      renderToStaticMarkup(
        <ReportCell
          cell={undefined}
          resultTypes={RESULT_TYPES}
          display={DEFAULT_GLUCOSE_REPORT_DISPLAY}
        />,
      ),
    ).toBe('');
  });
});

/* -------------------- R22 展示项勾选（2026-11-19 需求人裁定） -------------------- */

describe('ReportCell — R22 展示项勾选（时间/操作人）', () => {
  it('取消「检测时间」：常规记录不再展示 (HH:mm)，值照常', () => {
    const text = textOf(render([entry()], RESULT_TYPES, display({ time: false })));

    expect(text).not.toContain('(08:30)');
    expect(text).toContain('6.8');
  });

  it('取消「检测时间」：特殊时段来源记录的时间仍恒展示（规则 6）', () => {
    const text = textOf(
      render(
        [entry({ sourceType: TIME_SLOT_CATEGORY.SPECIAL, time: '09:05', sourceSlotName: '复测' })],
        RESULT_TYPES,
        display({ time: false }),
      ),
    );

    expect(text).toContain('(09:05)');
    // 弃用特殊时段的后缀（裁定 Q1：弃用时段自己的名称）不受时间勾选影响
    expect(text).toContain('(复测)');
  });

  it('取消「操作人」：第 2 行记录者隐藏（规则 6「其他几个继续受控」：特殊时段同样隐藏）', () => {
    const normal = textOf(render([entry()], RESULT_TYPES, display({ operator: false })));
    expect(normal).not.toContain('李护士');
    expect(normal).toContain('6.8(08:30)');

    const special = textOf(
      render(
        [entry({ sourceType: TIME_SLOT_CATEGORY.SPECIAL, nurseName: '王护士' })],
        RESULT_TYPES,
        display({ operator: false }),
      ),
    );
    expect(special).not.toContain('王护士');
  });

  it('nurseName 为 null 且勾选操作人：仍显示 - 占位（D7 口径不变）', () => {
    expect(textOf(render([entry({ nurseName: null })]))).toContain('-');
  });
});

describe('filterReportRows — R22 记录级过滤（裁定 Q3/Q4/Q5/Q6）', () => {
  function row(entries: GlucoseReportEntry[], date = '2026-11-19'): GlucoseReportRow {
    return { date, cells: [{ slotCode: 'BREAKFAST_POST', entries }] };
  }

  const mixed = [
    entry({ time: '08:30' }), // 常规
    entry({ time: '09:00', sourceType: TIME_SLOT_CATEGORY.INTENSIVE, sourceSlotName: '强化-上午' }),
    entry({ time: '09:05', sourceType: TIME_SLOT_CATEGORY.SPECIAL, sourceSlotName: '复测' }), // 弃用特殊（合并展示）
  ];

  it('常规+强化都勾选：返回原引用，不做拷贝', () => {
    const rows = [row(mixed)];

    expect(filterReportRows(rows, DEFAULT_GLUCOSE_REPORT_DISPLAY)).toBe(rows);
  });

  it('取消「常规血糖」：只滤掉常规来源，强化与特殊保留（控记录不控列）', () => {
    const result = filterReportRows([row(mixed)], display({ normal: false }));

    expect(result[0].cells[0].entries.map((item) => item.time)).toEqual(['09:00', '09:05']);
  });

  it('取消「强化血糖」：只滤掉强化来源（含带强化后缀的记录）', () => {
    const result = filterReportRows([row(mixed)], display({ intensive: false }));

    expect(result[0].cells[0].entries.map((item) => item.time)).toEqual(['08:30', '09:05']);
  });

  it('弃用时段记录按原时段类型跟随勾选（裁定 Q4）：原常规→受常规控制，原特殊→恒展示', () => {
    const retired = [
      entry({ time: '22:30', sourceType: TIME_SLOT_CATEGORY.NORMAL, sourceSlotName: '睡前' }),
      entry({ time: '09:05', sourceType: TIME_SLOT_CATEGORY.SPECIAL, sourceSlotName: '复测' }),
    ];

    const result = filterReportRows([row(retired)], display({ normal: false }));

    expect(result[0].cells[0].entries.map((item) => item.time)).toEqual(['09:05']);
  });

  it('记录全被过滤的日期行保留为空行（裁定 Q6：分页 total 由服务端按日期算）', () => {
    const result = filterReportRows(
      [row([entry({ time: '08:30' })]), row([entry({ time: '09:00' })], '2026-11-18')],
      display({ normal: false }),
    );

    expect(result).toHaveLength(2);
    expect(result[0].cells[0].entries).toHaveLength(0);
    expect(result[1].cells[0].entries).toHaveLength(0);
  });

  it('时间/操作人勾选不影响行级过滤（它们只控制格内渲染）', () => {
    const rows = [row(mixed)];

    expect(filterReportRows(rows, display({ time: false, operator: false }))).toBe(rows);
  });
});

describe('buildAddPrefill — 空白单元格添加预填（R25 裁定 Q15）', () => {
  it('拼接「该行日期 + 当前时刻的时分秒」，时段取该列 code', () => {
    const now = dayjs('2026-11-20 14:35:09');
    const prefill = buildAddPrefill('2026-11-18', 'LUNCH_POST', now);

    // 历史日期也照此拼接：日期来自行、时分秒来自 now（裁定 Q15）
    expect(prefill.measuredAt.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-11-18 14:35:09');
    expect(prefill.mealContext).toBe('LUNCH_POST');
  });

  it('行日期为当天时同样拼接当前时分秒', () => {
    const now = dayjs('2026-11-20 07:00:00');
    const prefill = buildAddPrefill('2026-11-20', 'FASTING', now);

    expect(prefill.measuredAt.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-11-20 07:00:00');
    expect(prefill.mealContext).toBe('FASTING');
  });
});
