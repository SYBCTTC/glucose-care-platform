import { describe, expect, it } from 'vitest';
import { createGlucoseSchema, GLUCOSE_ENTRY_DETECT, MEAL_CONTEXT_MAX } from './schema';

/**
 * `mealContext` 的契约：**只做格式校验，不做白名单**。
 *
 * 时段是动态数据（表 `TimeSlot`），code 是否存在、是否启用只能由服务端查库判定。
 * 这里曾用静态 `TIME_SLOTS` 做白名单，导致库里新增时段而未同步 shared 时误拒合法提交。
 */

const OPERATOR_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** 一份合法入参；measuredAt 固定为过去时间，避免"不能晚于当前时间"干扰断言 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    measuredAt: '2026-01-05 08:30:00',
    mealContext: 'FASTING',
    resultType: GLUCOSE_ENTRY_DETECT,
    valueMmolL: 6.1,
    testStrip: 1,
    operatorId: OPERATOR_ID,
    remark: null,
    ...overrides,
  };
}

describe('createGlucoseSchema.mealContext', () => {
  it('静态清单里的 code 通过', () => {
    expect(createGlucoseSchema.safeParse(input()).success).toBe(true);
  });

  it('格式合法但不在静态 TIME_SLOTS 中的 code 也通过（可用性交给服务端查库）', () => {
    const parsed = createGlucoseSchema.safeParse(input({ mealContext: 'CUSTOM_SLOT' }));

    expect(parsed.success).toBe(true);
  });

  it('两端空白被裁剪', () => {
    expect(createGlucoseSchema.parse(input({ mealContext: '  RANDOM  ' })).mealContext).toBe(
      'RANDOM',
    );
  });

  it('空串与纯空格被拒', () => {
    for (const mealContext of ['', '   ']) {
      const parsed = createGlucoseSchema.safeParse(input({ mealContext }));
      expect(parsed.success, `mealContext=${JSON.stringify(mealContext)}`).toBe(false);
    }
  });

  it(`超过 ${MEAL_CONTEXT_MAX} 字符被拒（与 TimeSlot.code VarChar(32) 对齐）`, () => {
    const tooLong = 'A'.repeat(MEAL_CONTEXT_MAX + 1);

    expect(createGlucoseSchema.safeParse(input({ mealContext: tooLong })).success).toBe(false);
    expect(
      createGlucoseSchema.safeParse(input({ mealContext: 'A'.repeat(MEAL_CONTEXT_MAX) })).success,
    ).toBe(true);
  });

  it('缺失或非字符串被拒', () => {
    expect(createGlucoseSchema.safeParse(input({ mealContext: undefined })).success).toBe(false);
    expect(createGlucoseSchema.safeParse(input({ mealContext: 123 })).success).toBe(false);
  });
});
