import { describe, expect, it } from 'vitest';
import {
  createGlucoseSchema,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_RECORD_PAGE_SIZE,
  glucoseRecordQuerySchema,
  glucoseTrendQuerySchema,
  MEAL_CONTEXT_MAX,
} from './schema';

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

/**
 * R27 血糖记录列表查询契约。
 * 时间口径与报表契约一致（秒粒度本地时间、闭区间、单侧可缺省）；
 * 分页默认 15 条**记录**（与报表的 15 个「日期」语义不同，常量独立）。
 */
describe('glucoseRecordQuerySchema — 血糖记录列表查询（R27）', () => {
  it('默认值：page=1、pageSize=GLUCOSE_RECORD_PAGE_SIZE(15)', () => {
    const parsed = glucoseRecordQuerySchema.parse({});

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(GLUCOSE_RECORD_PAGE_SIZE);
    expect(GLUCOSE_RECORD_PAGE_SIZE).toBe(15);
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.endTime).toBeUndefined();
  });

  it('startTime/endTime 按本地时区解析为 Date（与报表契约同口径）', () => {
    const parsed = glucoseRecordQuerySchema.parse({
      startTime: '2026-11-18 10:00:00',
      endTime: '2026-11-20 23:59:59',
    });

    expect(parsed.startTime).toEqual(new Date(2026, 10, 18, 10, 0, 0));
    expect(parsed.endTime).toEqual(new Date(2026, 10, 20, 23, 59, 59));
  });

  it('时间格式非法被拒（10001 由服务端 ZodValidationPipe 落地）', () => {
    expect(glucoseRecordQuerySchema.safeParse({ startTime: '2026-11-18' }).success).toBe(false);
    expect(glucoseRecordQuerySchema.safeParse({ endTime: 'not-a-date' }).success).toBe(false);
  });

  it('page/pageSize 支持查询串数字并拒绝越界', () => {
    expect(glucoseRecordQuerySchema.parse({ page: '2', pageSize: '15' })).toMatchObject({
      page: 2,
      pageSize: 15,
    });
    expect(glucoseRecordQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(glucoseRecordQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
    // max(100) 仅服务端防御：前端固定 15、无条数切换器
    expect(glucoseRecordQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(glucoseRecordQuerySchema.safeParse({ pageSize: 1.5 }).success).toBe(false);
  });
});

/**
 * P3-7 血糖趋势查询契约（2026-11-24 增补 mealContexts 时段过滤）。
 * 前端以逗号分隔字符串下发（http.get 序列化数组为 `A,B,C`），schema transform 还原为数组。
 */
describe('glucoseTrendQuerySchema — 血糖趋势查询（P3-7）', () => {
  it('缺省 mealContexts → undefined（「全部」：服务端不过滤）', () => {
    expect(glucoseTrendQuerySchema.parse({}).mealContexts).toBeUndefined();
  });

  it('逗号分隔字符串 → 数组（时段过滤）', () => {
    expect(glucoseTrendQuerySchema.parse({ mealContexts: 'FASTING,BEDTIME' }).mealContexts).toEqual(
      ['FASTING', 'BEDTIME'],
    );
  });

  it('每项裁剪空白、剔除空段（防御尾随逗号/空格）', () => {
    expect(
      glucoseTrendQuerySchema.parse({ mealContexts: ' FASTING , ,BEDTIME ,' }).mealContexts,
    ).toEqual(['FASTING', 'BEDTIME']);
  });

  it('空串 → 空数组（服务端视为不过滤）', () => {
    expect(glucoseTrendQuerySchema.parse({ mealContexts: '' }).mealContexts).toEqual([]);
  });

  it('startTime/endTime 仍按本地时区解析为 Date（与报表/记录同口径）', () => {
    const parsed = glucoseTrendQuerySchema.parse({
      startTime: '2026-11-18 10:00:00',
      endTime: '2026-11-20 23:59:59',
    });

    expect(parsed.startTime).toEqual(new Date(2026, 10, 18, 10, 0, 0));
    expect(parsed.endTime).toEqual(new Date(2026, 10, 20, 23, 59, 59));
  });
});
