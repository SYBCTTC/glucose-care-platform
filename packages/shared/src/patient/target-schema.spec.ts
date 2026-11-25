import { describe, expect, it } from 'vitest';
import { updatePatientGlucoseTargetsSchema } from './target-schema';

/**
 * 患者控糖目标 PATCH 入参校验。
 * 规格 `docs/specs/patient-glucose-target.md` §4 R2 / §8（裁定 J / R / V）。
 *
 * 这里只测**格式与跨字段关系**；「时段码是否属于展示集合」属查库判定，
 * 由 `patient-glucose-target.service.spec.ts` 覆盖（同 `mealContext` 的分工，AGENTS.md §4.4）。
 */

/** 一份合法入参：两个时段 + 预警值 */
function input(overrides: Record<string, unknown> = {}) {
  return {
    targets: [
      { timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.0 },
      { timeSlotCode: 'BEDTIME', valueDown: 5.0, valueUp: 8.3 },
    ],
    alert: { lowThreshold: 3.9, highThreshold: 16.7 },
    ...overrides,
  };
}

/** 把校验结果压成 `{path, message}[]`，便于断言「错误挂在哪个字段上」 */
function issuesOf(payload: unknown): Array<{ path: string; message: string }> {
  const parsed = updatePatientGlucoseTargetsSchema.safeParse(payload);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

describe('updatePatientGlucoseTargetsSchema — 基线', () => {
  it('合法入参通过', () => {
    expect(updatePatientGlucoseTargetsSchema.safeParse(input()).success).toBe(true);
  });

  it('两值都为 null 通过（清空 = 删行语义，裁定 V）', () => {
    const parsed = updatePatientGlucoseTargetsSchema.safeParse(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: null, valueUp: null }] }),
    );
    expect(parsed.success).toBe(true);
  });

  it('空 targets 数组通过（把全部时段清空）', () => {
    expect(updatePatientGlucoseTargetsSchema.safeParse(input({ targets: [] })).success).toBe(true);
  });

  it('缺 alert 被拒（预警值是必填项，裁定 O）', () => {
    expect(issuesOf({ targets: [] }).length).toBeGreaterThan(0);
  });
});

describe('updatePatientGlucoseTargetsSchema — 半配置（裁定 V）', () => {
  it('只给下限 → 错误挂在缺失的 valueUp 上', () => {
    const issues = issuesOf(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: null }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('targets.0.valueUp');
    expect(issues[0].message).toContain('同时');
  });

  it('只给上限 → 错误挂在缺失的 valueDown 上', () => {
    const issues = issuesOf(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: null, valueUp: 7.0 }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('targets.0.valueDown');
  });

  it('多个时段各自半配置 → 每个都报一条，互不掩盖', () => {
    const issues = issuesOf(
      input({
        targets: [
          { timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: null },
          { timeSlotCode: 'BEDTIME', valueDown: null, valueUp: 8.3 },
        ],
      }),
    );
    expect(issues.map((issue) => issue.path)).toEqual(['targets.0.valueUp', 'targets.1.valueDown']);
  });
});

describe('updatePatientGlucoseTargetsSchema — 大小关系（裁定 J）', () => {
  it('下限 > 上限被拒，错误挂在该时段的 valueUp 上', () => {
    const issues = issuesOf(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 7.0, valueUp: 4.4 }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('targets.0.valueUp');
  });

  it('下限 == 上限被拒（严格小于：相等会让 0/1/2 判定区间塌缩）', () => {
    const issues = issuesOf(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 5.0, valueUp: 5.0 }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('targets.0.valueUp');
  });

  it('预警值 low >= high 被拒', () => {
    const issues = issuesOf(input({ alert: { lowThreshold: 16.7, highThreshold: 3.9 } }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('alert.highThreshold');
  });

  it('预警值 low == high 被拒', () => {
    expect(issuesOf(input({ alert: { lowThreshold: 5.0, highThreshold: 5.0 } }))).toHaveLength(1);
  });

  it('时段目标比预警值更宽也合法（裁定 J 明确不校验两者关系）', () => {
    // 预警值与时段目标是两套独立机制：前者画趋势图色带，后者判 resultType。
    // 强行约束大小关系会拒绝合法临床配置，故此处必须通过。
    const parsed = updatePatientGlucoseTargetsSchema.safeParse(
      input({
        targets: [{ timeSlotCode: 'FASTING', valueDown: 2.0, valueUp: 30.0 }],
        alert: { lowThreshold: 3.9, highThreshold: 16.7 },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe('updatePatientGlucoseTargetsSchema — 数值边界（裁定 R）', () => {
  it('0.6 与 33.3 边界值通过（含边界，与血糖读数同口径）', () => {
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 0.6, valueUp: 33.3 }] })),
    ).toHaveLength(0);
  });

  it('低于 0.6 或高于 33.3 被拒', () => {
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 0.5, valueUp: 7.0 }] })),
    ).toHaveLength(1);
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 33.4 }] })),
    ).toHaveLength(1);
  });

  it('超过 1 位小数被拒（库列 DECIMAL(4,1)）', () => {
    const issues = issuesOf(
      input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.44, valueUp: 7.0 }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('1 位小数');
  });

  it('4.4 / 7.7 这类浮点易误判的值通过（容差写法而非取模）', () => {
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'FASTING', valueDown: 4.4, valueUp: 7.7 }] })),
    ).toHaveLength(0);
  });

  it('字符串数值被拒（不做隐式转换，前端须传 number）', () => {
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'FASTING', valueDown: '4.4', valueUp: 7.0 }] })),
    ).toHaveLength(1);
  });
});

describe('updatePatientGlucoseTargetsSchema — 时段码（AGENTS.md §4.4）', () => {
  it('不做白名单：格式合法的自定义 code 通过（可用性交服务端查库）', () => {
    expect(
      issuesOf(input({ targets: [{ timeSlotCode: 'CUSTOM_SLOT', valueDown: 4.4, valueUp: 7.0 }] })),
    ).toHaveLength(0);
  });

  it('两端空白被裁剪', () => {
    const parsed = updatePatientGlucoseTargetsSchema.parse(
      input({ targets: [{ timeSlotCode: '  FASTING  ', valueDown: 4.4, valueUp: 7.0 }] }),
    );
    expect(parsed.targets[0].timeSlotCode).toBe('FASTING');
  });

  it('空串与纯空格被拒', () => {
    for (const timeSlotCode of ['', '   ']) {
      expect(
        issuesOf(input({ targets: [{ timeSlotCode, valueDown: 4.4, valueUp: 7.0 }] })),
        `timeSlotCode=${JSON.stringify(timeSlotCode)}`,
      ).toHaveLength(1);
    }
  });

  it('超过 32 字符被拒（对齐 TimeSlot.code @db.VarChar(32)）', () => {
    expect(
      issuesOf(
        input({ targets: [{ timeSlotCode: 'A'.repeat(33), valueDown: 4.4, valueUp: 7.0 }] }),
      ),
    ).toHaveLength(1);
  });
});

describe('updatePatientGlucoseTargetsSchema — 请求体规模', () => {
  it('超过 64 个时段被拒（防超长请求体，非业务白名单）', () => {
    const targets = Array.from({ length: 65 }, (_, index) => ({
      timeSlotCode: `SLOT_${index}`,
      valueDown: 4.4,
      valueUp: 7.0,
    }));
    expect(issuesOf(input({ targets }))).toHaveLength(1);
  });

  it('恰好 64 个时段通过', () => {
    const targets = Array.from({ length: 64 }, (_, index) => ({
      timeSlotCode: `SLOT_${index}`,
      valueDown: 4.4,
      valueUp: 7.0,
    }));
    expect(issuesOf(input({ targets }))).toHaveLength(0);
  });
});
