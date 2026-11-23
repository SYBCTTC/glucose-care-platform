/**
 * R27 血糖记录列表**纯函数/纯组件**测试。
 *
 * 与 GlucoseReportTab.spec.tsx 同一口径：web 测试跑在 node 环境（无 jsdom），
 * 用 renderToStaticMarkup 渲染展示型组件并断言输出 HTML；
 * 外层 `GlucoseRecordTab` 依赖 Outlet context 与网络请求，靠 typecheck + 手工 e2e 验证。
 *
 * 验收主体（docs/specs/glucose-record.md）：
 *  - 规则 2：检测时间分钟级截断、时段 code→名称（含停用项、回退 code）、空值 '-'；
 *  - 裁定 Q3：血糖值列数值/标签双形态 + 字典色（色+文双通道）；
 *  - 规则 4：血糖值单元格可点击（含非数值行）→ 复核弹窗入口。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DictItemOption, GlucoseRecordListItem, TimeSlotOption } from '@gc/shared';
import {
  RecordValueCell,
  buildRecordValue,
  formatMealContext,
  formatRecordTime,
} from './GlucoseRecordTab';

/** 与 seed 一致的 DY-RESULT 片段（'3' 标签是 Low=血糖仪超下限，不是"未测"） */
const RESULT_TYPES: DictItemOption[] = [
  { code: '0', label: '偏低', color: '#4BB2ED', checkable: false, counted: true, sortOrder: 0 },
  { code: '1', label: '正常', color: '#389E0D', checkable: false, counted: true, sortOrder: 1 },
  { code: '2', label: '偏高', color: '#FF1516', checkable: false, counted: true, sortOrder: 2 },
  { code: '3', label: 'Low', color: '#4BB2ED', checkable: true, counted: true, sortOrder: 3 },
  { code: '4', label: 'High', color: '#FF1516', checkable: true, counted: true, sortOrder: 4 },
  { code: '5', label: '拒检', color: '#8C8C8C', checkable: true, counted: false, sortOrder: 5 },
];

function slot(code: string, name: string, enabled = true): TimeSlotOption {
  return {
    code,
    name,
    type: 1,
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
  slot('BREAKFAST', '早餐后'),
  // 停用项也下发：历史血糖需按 code 回显名称（R22 口径）
  slot('OLD_SLOT', '旧时段', false),
];

function item(overrides: Partial<GlucoseRecordListItem> = {}): GlucoseRecordListItem {
  return {
    id: 'g-1',
    measuredAt: '2026-11-19 09:00:00',
    mealContext: 'FASTING',
    resultType: '1',
    valueMmolL: 6.8,
    operatorName: '李护士',
    remark: null,
    ...overrides,
  };
}

describe('formatRecordTime — 检测时间分钟级展示（规则 2）', () => {
  it('秒级契约串截到分钟', () => {
    expect(formatRecordTime('2026-11-19 09:00:00')).toBe('2026-11-19 09:00');
    expect(formatRecordTime('2026-11-19 23:59:59')).toBe('2026-11-19 23:59');
  });

  it('空值 → -；非法值防御性回退原文', () => {
    expect(formatRecordTime('')).toBe('-');
    expect(formatRecordTime('not-a-time')).toBe('not-a-time');
  });
});

describe('formatMealContext — 检测时段（规则 2/8）', () => {
  it('code → 动态时段名；停用项同样回显', () => {
    expect(formatMealContext('FASTING', TIME_SLOTS)).toBe('空腹');
    expect(formatMealContext('OLD_SLOT', TIME_SLOTS)).toBe('旧时段');
  });

  it('查不到回退 code（禁止按名称匹配）；null → -', () => {
    expect(formatMealContext('REMOVED', TIME_SLOTS)).toBe('REMOVED');
    expect(formatMealContext(null, TIME_SLOTS)).toBe('-');
  });
});

describe('buildRecordValue — 血糖值双形态 + 字典色（裁定 Q3）', () => {
  it('数值型(0/1/2)：一位小数数值 + 自身字典色', () => {
    expect(buildRecordValue({ resultType: '1', valueMmolL: 6.8 }, RESULT_TYPES)).toEqual({
      text: '6.8',
      color: '#389E0D',
    });
    expect(buildRecordValue({ resultType: '2', valueMmolL: 18.5 }, RESULT_TYPES)).toEqual({
      text: '18.5',
      color: '#FF1516',
    });
  });

  it('数值型但 valueMmolL 防御性为 null → -', () => {
    expect(buildRecordValue({ resultType: '1', valueMmolL: null }, RESULT_TYPES).text).toBe('-');
  });

  it('非数值型(3~9)：字典标签 + 字典色（Low/High/拒检…）', () => {
    expect(buildRecordValue({ resultType: '4', valueMmolL: null }, RESULT_TYPES)).toEqual({
      text: 'High',
      color: '#FF1516',
    });
    expect(buildRecordValue({ resultType: '3', valueMmolL: null }, RESULT_TYPES)).toEqual({
      text: 'Low',
      color: '#4BB2ED',
    });
    expect(buildRecordValue({ resultType: '5', valueMmolL: null }, RESULT_TYPES)).toEqual({
      text: '拒检',
      color: '#8C8C8C',
    });
  });

  it('字典查不到的非数值码回退 code 本身', () => {
    expect(buildRecordValue({ resultType: '9', valueMmolL: null }, RESULT_TYPES)).toEqual({
      text: '9',
      color: undefined,
    });
  });
});

describe('RecordValueCell — 可点击血糖值单元格（规则 4）', () => {
  it('数值行：role=button + 数值 + 字典色 + 键盘可达', () => {
    const html = renderToStaticMarkup(
      <RecordValueCell item={item()} resultTypes={RESULT_TYPES} onClick={() => undefined} />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('6.8');
    // 字典色进 style（色+文双通道：文案自身已可区分，颜色是冗余通道）
    expect(html.toLowerCase()).toContain('#389e0d');
    expect(html).toContain('aria-label="血糖值 6.8，点击查看详情"');
  });

  it('非数值行（拒检）同样可点击，显示字典标签', () => {
    const html = renderToStaticMarkup(
      <RecordValueCell
        item={item({ resultType: '5', valueMmolL: null })}
        resultTypes={RESULT_TYPES}
        onClick={() => undefined}
      />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('拒检');
  });

  // 点击 → 复核弹窗的交互链路（携带记录 id）在 node 环境无法触发事件，由手工 e2e 验证
});
