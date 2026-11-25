import { describe, expect, it } from 'vitest';
import type {
  DictItemOption,
  GlucoseRecordListItem,
  GlucoseReportEntry,
  GlucoseReportResponse,
} from '@gc/shared';
import { DEFAULT_GLUCOSE_REPORT_DISPLAY } from '@/pages/inpatient/patient-detail/detail-tabs';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';
import { buildRecordPrintCounted, buildReportPrintUnits, countedCodeSet } from './buildPrintUnits';

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

describe('buildReportPrintUnits — 报表打印单元（裁定 C1 + 规格 §4 规则 6/16）', () => {
  it('同一日期同一时段多条记录 → 每条独占一行，按列序排列', () => {
    const e1 = entry({ id: 'e1', time: '08:00' });
    const e2 = entry({ id: 'e2', time: '10:30' });
    const e3 = entry({ id: 'e3', time: '09:00' });
    const data = report({
      rows: [
        {
          date: '2026-11-20',
          cells: [
            { slotCode: 'FASTING', entries: [e1, e2] },
            { slotCode: 'BREAKFAST_POST', entries: [e3] },
          ],
        },
      ],
    });

    const units = buildReportPrintUnits(data, ALL_ON, countedCodeSet(RESULT_TYPES));

    // 行级单元：每条记录一个单元，key = 记录 id；列序优先（同列内保持时间升序）
    expect(units.map((unit) => [unit.slotIndex, unit.key, unit.date])).toEqual([
      [0, 'e1', '2026-11-20'],
      [0, 'e2', '2026-11-20'],
      [1, 'e3', '2026-11-20'],
    ]);
  });

  it('多日期按日期升序摊平为行级单元序列（行级装箱、日期组可跨页的前提）', () => {
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
      ['2026-11-20', 'a1'],
      ['2026-11-21', 'b1'],
      ['2026-11-21', 'b2'],
    ]);
    // 页脚计数：行级 0/1
    expect(units.map((unit) => unit.counted)).toEqual([1, 1, 1]);
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

  it('counted 计数：只数 counted=true 的记录（拒检等 5~9 不计入）', () => {
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

    expect(units).toHaveLength(2); // 拒检记录仍占一行（可见），只是不计数
    expect(units.map((unit) => unit.counted)).toEqual([1, 0]);
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
