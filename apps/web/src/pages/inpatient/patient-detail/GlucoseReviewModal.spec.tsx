/**
 * R25 review 弹框纯函数 `buildReviewFields` 测试。
 *
 * 只测纯函数：弹框本体依赖 Outlet context、网络请求与 antd 受控 Form，
 * 在 node 测试环境（无 jsdom）里跑不起来，靠 typecheck + 手工 e2e 验证。
 * `buildReviewFields` 是 review 模式展示口径（数值/非数值血糖值、字典色、时段名回退、
 * 空值 `-`、固定「手动入录」）的验收主体，故单独导出可测。
 */
import { describe, expect, it } from 'vitest';
import { GLUCOSE_UNIT, TIME_SLOT_CATEGORY } from '@gc/shared';
import type {
  DictItemOption,
  GlucoseRecordDetail,
  TimeSlotOption,
} from '@gc/shared';
import { buildReviewFields, type ReviewField } from './GlucoseReviewModal';

/** 与 seed 一致的 DY-RESULT 片段：'0'/'1'/'2' 数值型，'3'~'5' 非数值型 */
const RESULT_TYPES = [
  { code: '0', label: '偏低', color: '#4BB2ED' },
  { code: '1', label: '正常', color: '#389E0D' },
  { code: '2', label: '偏高', color: '#FF1516' },
  { code: '3', label: 'Low', color: '#4BB2ED' },
  { code: '4', label: 'High', color: '#FF1516' },
  { code: '5', label: '拒检', color: '#8C8C8C' },
] as unknown as DictItemOption[];

function slot(code: string, name: string, enabled = true): TimeSlotOption {
  return {
    code,
    name,
    type: TIME_SLOT_CATEGORY.NORMAL,
    startTime: null,
    endTime: null,
    timeScope: null,
    valueDown: null,
    valueUp: null,
    sortOrder: 0,
    enabled,
  };
}

const TIME_SLOTS: TimeSlotOption[] = [
  slot('FASTING', '空腹'),
  slot('BREAKFAST_POST', '早餐后'),
  // 停用项仍下发，供历史记录回显名称（裁定 Q12）
  slot('OLD_SLOT', '旧时段', false),
];

function detail(overrides: Partial<GlucoseRecordDetail> = {}): GlucoseRecordDetail {
  return {
    id: 'g-1',
    measuredAt: '2026-11-20 08:30:00',
    mealContext: 'BREAKFAST_POST',
    resultType: '1',
    valueMmolL: 6.8,
    testStrip: 1,
    operatorId: 'u-1',
    operatorName: '李护士',
    remark: '复测确认',
    ...overrides,
  };
}

/** 按 label 取行，便于断言 */
function fieldOf(fields: ReviewField[], label: string): ReviewField {
  const found = fields.find((field) => field.label === label);
  if (!found) {
    throw new Error(`缺少字段行：${label}`);
  }
  return found;
}

describe('buildReviewFields — review 模式展示口径（R25）', () => {
  it('固定 7 行、顺序与标签稳定，入录方式恒为「手动入录」', () => {
    const fields = buildReviewFields(detail(), RESULT_TYPES, TIME_SLOTS);

    expect(fields.map((field) => field.label)).toEqual([
      '检测时间',
      '检测时段',
      '血糖值',
      '试纸',
      '记录者',
      '入录方式',
      '备注',
    ]);
    expect(fieldOf(fields, '入录方式').value).toBe('手动入录');
  });

  it('数值型结果（0/1/2）：血糖值显示 `x.x mmol/L`，按字典色着色', () => {
    const fields = buildReviewFields(
      detail({ resultType: '2', valueMmolL: 12.34 }),
      RESULT_TYPES,
      TIME_SLOTS,
    );
    const value = fieldOf(fields, '血糖值');

    expect(value.value).toBe(`12.3 ${GLUCOSE_UNIT}`);
    expect(value.color).toBe('#FF1516'); // '2' 偏高的字典色
  });

  it('数值型但 valueMmolL 为 null：血糖值显示 `-`（仍按字典色）', () => {
    const fields = buildReviewFields(
      detail({ resultType: '1', valueMmolL: null }),
      RESULT_TYPES,
      TIME_SLOTS,
    );

    expect(fieldOf(fields, '血糖值').value).toBe('-');
  });

  it('非数值型结果（3~9）：血糖值显示字典 label，不显示数值', () => {
    const fields = buildReviewFields(
      detail({ resultType: '5', valueMmolL: null }),
      RESULT_TYPES,
      TIME_SLOTS,
    );
    const value = fieldOf(fields, '血糖值');

    expect(value.value).toBe('拒检');
    expect(value.color).toBe('#8C8C8C');
  });

  it('字典未命中：血糖值回退 resultType 原文、不着色（color undefined）', () => {
    const fields = buildReviewFields(detail({ resultType: '9' }), [], TIME_SLOTS);
    const value = fieldOf(fields, '血糖值');

    // '9' 非数值型 → 取字典 label，字典空 → 回退 code 原文
    expect(value.value).toBe('9');
    expect(value.color).toBeUndefined();
  });

  it('检测时段：按 code 查动态时段名（含停用项回显）', () => {
    expect(
      fieldOf(buildReviewFields(detail(), RESULT_TYPES, TIME_SLOTS), '检测时段').value,
    ).toBe('早餐后');
    expect(
      fieldOf(
        buildReviewFields(detail({ mealContext: 'OLD_SLOT' }), RESULT_TYPES, TIME_SLOTS),
        '检测时段',
      ).value,
    ).toBe('旧时段');
  });

  it('检测时段查不到 → 回退 code 原文；mealContext 为 null → `-`', () => {
    expect(
      fieldOf(
        buildReviewFields(detail({ mealContext: 'UNKNOWN' }), RESULT_TYPES, TIME_SLOTS),
        '检测时段',
      ).value,
    ).toBe('UNKNOWN');
    expect(
      fieldOf(buildReviewFields(detail({ mealContext: null }), RESULT_TYPES, TIME_SLOTS), '检测时段')
        .value,
    ).toBe('-');
  });

  it('空值一律 `-`：试纸/记录者/备注/检测时间', () => {
    const fields = buildReviewFields(
      detail({
        measuredAt: '',
        testStrip: null,
        operatorName: null,
        remark: '   ',
      }),
      RESULT_TYPES,
      TIME_SLOTS,
    );

    expect(fieldOf(fields, '检测时间').value).toBe('-');
    expect(fieldOf(fields, '试纸').value).toBe('-');
    expect(fieldOf(fields, '记录者').value).toBe('-');
    expect(fieldOf(fields, '备注').value).toBe('-');
  });

  it('试纸非空转字符串、备注 trim 后展示', () => {
    const fields = buildReviewFields(
      detail({ testStrip: 12, remark: '  餐后两小时  ' }),
      RESULT_TYPES,
      TIME_SLOTS,
    );

    expect(fieldOf(fields, '试纸').value).toBe('12');
    expect(fieldOf(fields, '备注').value).toBe('餐后两小时');
  });
});
