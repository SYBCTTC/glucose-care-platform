import { describe, expect, it } from 'vitest';
import type {
  DictItemOption,
  GlucoseRecordListItem,
  GlucoseReportEntry,
  GlucoseReportResponse,
} from '@gc/shared';
import { DEFAULT_GLUCOSE_REPORT_DISPLAY } from '@/pages/inpatient/patient-detail/detail-tabs';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';
import {
  buildRecordPrintCounted,
  buildReportPrintUnits,
  countedCodeSet,
  countVisibleReportRecords,
} from './buildPrintUnits';

/* -------------------------------------------------------------------------- */
/* 测试数据工厂                                                                  */
/* -------------------------------------------------------------------------- */

function dict(code: string, counted: boolean): DictItemOption {
  return { code, label: `类型${code}`, color: null, checkable: true, counted, sortOrder: 0 };
}

/** 结果类型字典：0~4 counted=true（含 Low/High），5~9 counted=false（拒检/外出…，seed 同口径） */
const RESULT_TYPES: DictItemOption[] = [
  dict('0', true),
  dict('1', true),
  dict('2', true),
  dict('3', true),
  dict('4', true),
  dict('5', false),
  dict('6', false),
];

function entry(overrides: Partial<GlucoseReportEntry> = {}): GlucoseReportEntry {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    valueMmolL: 5.5,
    resultType: '0',
    time: '08:00',
    nurseName: '护士A',
    sourceType: 1,
    sourceSlotName: null,
    ...overrides,
  };
}

function report(overrides: Partial<GlucoseReportResponse> = {}): GlucoseReportResponse {
  return {
    columns: [
      // type: TIME_SLOT_CATEGORY.NORMAL=1（普通时段成列），sortOrder 升序
      { code: 'FASTING', name: '空腹', type: 1, sortOrder: 1 },
      { code: 'BREAKFAST_POST', name: '早餐后', type: 1, sortOrder: 2 },
      { code: 'LUNCH_POST', name: '午餐后', type: 1, sortOrder: 3 },
    ],
    rows: [],
    page: 1,
    pageSize: 100,
    total: 0,
    rangeFrom: null,
    rangeTo: null,
    count: 0,
    stats: {
      total: 0,
      qualified: 0,
      hasHigh: false,
      hasLow: false,
      maxValueMmolL: null,
      maxResultType: null,
      minValueMmolL: null,
      minResultType: null,
    },
    ...overrides,
  };
}

const ALL_ON: GlucoseReportDisplay = { ...DEFAULT_GLUCOSE_REPORT_DISPLAY };

/* -------------------------------------------------------------------------- */

describe('countedCodeSet — 页脚计数口径（裁定 Q2：动态跟随字典，禁止硬编码 5~9）', () => {
  it('取字典 counted=true 的码集', () => {
    expect(countedCodeSet(RESULT_TYPES)).toEqual(new Set(['0', '1', '2', '3', '4']));
  });

  it('字典变化即跟随（把某类改成不计入 → 集合同步变）', () => {
    const modified = RESULT_TYPES.map((option) =>
      option.code === '4' ? { ...option, counted: false } : option,
    );
    expect(countedCodeSet(modified)).toEqual(new Set(['0', '1', '2', '3']));
  });
});

describe('buildReportPrintUnits — 报表打印单元（对齐子行，2026-11-26 裁定 + 规格 §4 规则 6/16）', () => {
  it('空腹2+早餐后2+午餐后1 → 2 个子行：各时段第 i 条落第 i 行，缺位为 null（需求人例 1）', () => {
    const f1 = entry({ id: 'f1', time: '06:00' });
    const f2 = entry({ id: 'f2', time: '06:30' });
    const b1 = entry({ id: 'b1', time: '08:00' });
    const b2 = entry({ id: 'b2', time: '08:30' });
    const l1 = entry({ id: 'l1', time: '12:00' });
    const data = report({
      rows: [
        {
          date: '2026-11-25',
          cells: [
            { slotCode: 'FASTING', entries: [f1, f2] },
            { slotCode: 'BREAKFAST_POST', entries: [b1, b2] },
            { slotCode: 'LUNCH_POST', entries: [l1] },
          ],
        },
      ],
    });

    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));

    expect(units.map((unit) => unit.key)).toEqual(['2026-11-25#0', '2026-11-25#1']);
    expect(units.map((unit) => unit.date)).toEqual(['2026-11-25', '2026-11-25']);
    // 行1 = 各时段第 1 条；行2 = 各时段第 2 条（午餐后无第 2 条 → null）
    expect(units[0].cells).toEqual([f1, b1, l1]);
    expect(units[1].cells).toEqual([f2, b2, null]);
    expect(units.map((unit) => unit.visible)).toEqual([3, 2]);
    expect(units.map((unit) => unit.counted)).toEqual([3, 2]);
  });

  it('早餐后增至 3 条 → 3 个子行，其余时段不受影响（需求人例 2）', () => {
    const f1 = entry({ id: 'f1' });
    const f2 = entry({ id: 'f2' });
    const b1 = entry({ id: 'b1' });
    const b2 = entry({ id: 'b2' });
    const b3 = entry({ id: 'b3' });
    const l1 = entry({ id: 'l1' });
    const data = report({
      rows: [
        {
          date: '2026-11-25',
          cells: [
            { slotCode: 'FASTING', entries: [f1, f2] },
            { slotCode: 'BREAKFAST_POST', entries: [b1, b2, b3] },
            { slotCode: 'LUNCH_POST', entries: [l1] },
          ],
        },
      ],
    });

    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));

    expect(units.map((unit) => unit.key)).toEqual(['2026-11-25#0', '2026-11-25#1', '2026-11-25#2']);
    expect(units[0].cells).toEqual([f1, b1, l1]);
    expect(units[1].cells).toEqual([f2, b2, null]);
    expect(units[2].cells).toEqual([null, b3, null]);
    expect(units.map((unit) => unit.visible)).toEqual([3, 2, 1]);
  });

  it('多日期按日期升序摊平为子行序列（日期组可跨页的前提）', () => {
    const data = report({
      rows: [
        { date: '2026-11-20', cells: [{ slotCode: 'FASTING', entries: [entry({ id: 'a1' })] }] },
        {
          date: '2026-11-21',
          cells: [
            { slotCode: 'BREAKFAST_POST', entries: [entry({ id: 'b1' }), entry({ id: 'b2' })] },
          ],
        },
      ],
    });

    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));

    expect(units.map((unit) => [unit.date, unit.key])).toEqual([
      ['2026-11-20', '2026-11-20#0'],
      ['2026-11-21', '2026-11-21#0'],
      ['2026-11-21', '2026-11-21#1'],
    ]);
  });

  it('无可见记录的日期整组跳过（裁定 16：勾选过滤后为空的日期不占行）', () => {
    const data = report({
      rows: [
        {
          date: '2026-11-20',
          cells: [
            {
              slotCode: 'FASTING',
              entries: [entry({ sourceType: 0, sourceSlotName: '强化-上午' })],
            },
          ],
        },
        { date: '2026-11-21', cells: [{ slotCode: 'FASTING', entries: [entry()] }] },
      ],
    });

    // 取消勾选「强化血糖」→ 11-20 的强化来源记录被过滤 → 该日期整组跳过
    const units = buildReportPrintUnits(
      data,
      { ...ALL_ON, intensive: false },
      countedCodeSet(RESULT_TYPES),
    );

    expect(units.map((unit) => unit.date)).toEqual(['2026-11-21']);
  });

  it('counted 只数字典 counted=true；visible 数全部可见记录（拒检可见不计数）', () => {
    const data = report({
      rows: [
        {
          date: '2026-11-20',
          cells: [
            {
              slotCode: 'FASTING',
              entries: [entry({ resultType: '0' }), entry({ resultType: '5', valueMmolL: null })],
            },
          ],
        },
      ],
    });

    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));

    expect(units).toHaveLength(2); // 拒检记录仍占一个子行（可见），只是不计入 counted
    expect(units.map((unit) => unit.counted)).toEqual([1, 0]);
    expect(units.map((unit) => unit.visible)).toEqual([1, 1]);
  });

  it('列集合外的格防御性跳过（columns 与 cells 同源，正常不发生）', () => {
    const data = report({
      rows: [
        {
          date: '2026-11-20',
          cells: [{ slotCode: 'UNKNOWN_SLOT', entries: [entry()] }],
        },
      ],
    });

    expect(buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES))).toEqual([]);
  });
});

describe('countVisibleReportRecords — 页脚「总计 Y 条」/审计留痕口径（2026-11-26 裁定）', () => {
  it('= 勾选过滤后 entry 总条数（含拒检/请假等 5~9，与 Σvisible 同口径）', () => {
    const data = report({
      rows: [
        {
          date: '2026-11-25',
          cells: [
            { slotCode: 'FASTING', entries: [entry(), entry()] },
            { slotCode: 'BREAKFAST_POST', entries: [entry({ resultType: '5', valueMmolL: null })] },
          ],
        },
        {
          date: '2026-11-19',
          cells: [
            {
              slotCode: 'FASTING',
              entries: [entry({ sourceType: 0, sourceSlotName: '强化-上午' })],
            },
          ],
        },
      ],
    });

    expect(countVisibleReportRecords(data, ALL_ON)).toBe(4);
    // 取消勾选强化 → 11-19 那条不渲染、不计数
    expect(countVisibleReportRecords(data, { ...ALL_ON, intensive: false })).toBe(3);
    // 与子行模型的 Σvisible 一致
    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));
    expect(units.reduce((sum, unit) => sum + unit.visible, 0)).toBe(4);
  });

  it('空 rows → 0', () => {
    expect(countVisibleReportRecords(report(), ALL_ON)).toBe(0);
  });
});

describe('buildRecordPrintCounted — 记录打印计数（裁定 Q3：X 按页内 counted 记录数）', () => {
  function item(resultType: string): GlucoseRecordListItem {
    return {
      id: `r-${resultType}-${Math.random().toString(36).slice(2)}`,
      measuredAt: '2026-11-20 08:00:00',
      mealContext: 'FASTING',
      valueMmolL: 5.5,
      resultType,
      operatorName: '护士A',
      remark: null,
    } as GlucoseRecordListItem;
  }

  it('逐条映射 counted 标志（0~4 计 1，5~9 计 0）', () => {
    const items = [item('0'), item('3'), item('5'), item('6')];

    expect(buildRecordPrintCounted(items, countedCodeSet(RESULT_TYPES))).toEqual([1, 1, 0, 0]);
  });

  it('空列表 → 空数组', () => {
    expect(buildRecordPrintCounted([], countedCodeSet(RESULT_TYPES))).toEqual([]);
  });
});
