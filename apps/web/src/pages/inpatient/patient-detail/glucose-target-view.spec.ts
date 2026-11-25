import { describe, expect, it } from 'vitest';
import { PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type { PatientGlucoseTargetsResponse, PermissionCode } from '@gc/shared';
import {
  buildDefaultFormValues,
  buildTargetFormValues,
  buildTargetPayload,
  canEditGlucoseTarget,
  canRestoreDefault,
  formatTargetRange,
  formatThreshold,
  isTargetFormDirty,
  parseFieldPath,
  type TargetFormValues,
} from './glucose-target-view';

/**
 * 控糖目标纯函数单测（规格 §6.2 §6.3、裁定 K / N / Q / R / S / V / W）。
 *
 * 为什么只测纯函数：web 测试跑在 node 环境（无 jsdom），容器组件依赖
 * useParams / useOutletContext / 网络请求无法渲染，靠 typecheck + 手工 e2e 兜。
 * 展示型子组件（TargetRangeValue / ThresholdValue）在 PatientGlucoseTargetTab.spec.tsx
 * 用 renderToStaticMarkup 覆盖。
 */

/** 两行样本：一行已配置、一行缺行（valueDown/valueUp 均为 null），覆盖裁定 K/V/S 的分支 */
const DATA: PatientGlucoseTargetsResponse = {
  targets: [
    {
      timeSlotCode: 'FASTING',
      timeSlotName: '空腹',
      valueDown: 4.4,
      valueUp: 7,
      defaultValueDown: 4.4,
      defaultValueUp: 7,
    },
    {
      timeSlotCode: 'BEDTIME',
      timeSlotName: '睡前',
      valueDown: null,
      valueUp: null,
      defaultValueDown: 5,
      defaultValueUp: 8.3,
    },
  ],
  alert: {
    lowThreshold: 3.9,
    highThreshold: 16.7,
    defaultLowThreshold: 3.9,
    defaultHighThreshold: 16.7,
  },
};

/** 全局 SystemConfig 缺失时的响应形状（裁定 Q：default* 为 null） */
const DATA_NO_GLOBAL: PatientGlucoseTargetsResponse = {
  ...DATA,
  alert: {
    lowThreshold: 3.9,
    highThreshold: 16.7,
    defaultLowThreshold: null,
    defaultHighThreshold: null,
  },
};

const hasTargetPermission = (permission: PermissionCode): boolean =>
  permission === PERMISSION.PATIENT_TARGET_UPDATE;
const hasNoPermission = (): boolean => false;

describe('formatTargetRange — 裁定 R 统一补 1 位小数', () => {
  it('整数上限补 .0（7 → 7.0），与录入弹框的展示口径一致', () => {
    expect(formatTargetRange(4.4, 7)).toBe('4.4-7.0 mmol/L');
  });

  it('整数下限补 .0（5 → 5.0）', () => {
    expect(formatTargetRange(5, 8.3)).toBe('5.0-8.3 mmol/L');
  });

  it('已有 1 位小数时不重复补零', () => {
    expect(formatTargetRange(4.4, 10)).toBe('4.4-10.0 mmol/L');
    expect(formatTargetRange(3.9, 16.7)).toBe('3.9-16.7 mmol/L');
  });
});

describe('formatTargetRange / formatThreshold — 裁定 K 缺行显示「未设置」', () => {
  it('两值都为 null（该行不存在）→ 未设置，不显示 0 或空白', () => {
    expect(formatTargetRange(null, null)).toBe('未设置');
  });

  it('半配置也显示未设置：库里不会出现，但契约允许 null，展示层必须兜住', () => {
    expect(formatTargetRange(null, 7)).toBe('未设置');
    expect(formatTargetRange(4.4, null)).toBe('未设置');
  });

  it('预警值 null（该行不存在）→ 未设置', () => {
    expect(formatThreshold(null)).toBe('未设置');
  });

  it('预警值有值时补 1 位小数并带单位', () => {
    expect(formatThreshold(3.9)).toBe('3.9 mmol/L');
    expect(formatThreshold(17)).toBe('17.0 mmol/L');
  });
});

describe('buildTargetFormValues — 打开弹框回填患者当前配置', () => {
  it('已配置行填入当前值，缺行填 null（输入框为空但可填，裁定 S）', () => {
    expect(buildTargetFormValues(DATA)).toEqual({
      targets: [
        { valueDown: 4.4, valueUp: 7 },
        { valueDown: null, valueUp: null },
      ],
      alert: { lowThreshold: 3.9, highThreshold: 16.7 },
    });
  });

  it('targets 与展示集合等长同序（提交时按 index 回取时段码的前提）', () => {
    const values = buildTargetFormValues(DATA);
    expect(values.targets).toHaveLength(DATA.targets.length);
  });
});

describe('buildDefaultFormValues — 裁定 S「恢复默认」', () => {
  it('时段取 TimeSlot 当前默认值：缺行时段也能恢复出默认值', () => {
    const defaults = buildDefaultFormValues(DATA);
    expect(defaults.targets[1]).toEqual({ valueDown: 5, valueUp: 8.3 });
  });

  it('预警值取全局 SystemConfig 值', () => {
    expect(buildDefaultFormValues(DATA).alert).toEqual({
      lowThreshold: 3.9,
      highThreshold: 16.7,
    });
  });

  it('已被医护改过的行也会被覆盖为默认值（这正是「恢复默认」的语义）', () => {
    const modified: PatientGlucoseTargetsResponse = {
      ...DATA,
      targets: [{ ...DATA.targets[0], valueDown: 4, valueUp: 6 }],
    };
    expect(buildDefaultFormValues(modified).targets[0]).toEqual({ valueDown: 4.4, valueUp: 7 });
  });
});

describe('canRestoreDefault — 裁定 Q 全局阈值缺失时按钮置灰', () => {
  it('全局阈值齐备 → 可用', () => {
    expect(canRestoreDefault(DATA)).toBe(true);
  });

  it('全局阈值缺失（default* 为 null）→ 置灰，避免恢复出一半默认值被后端 10001 拒绝', () => {
    expect(canRestoreDefault(DATA_NO_GLOBAL)).toBe(false);
  });

  it('数据未加载（null）→ 置灰', () => {
    expect(canRestoreDefault(null)).toBe(false);
  });

  it('只缺一个全局阈值也置灰（半配置无意义）', () => {
    expect(
      canRestoreDefault({
        ...DATA,
        alert: { ...DATA.alert, defaultHighThreshold: null },
      }),
    ).toBe(false);
  });
});

describe('buildTargetPayload — 裁定 N 全量提交 / 裁定 V 清空即删行', () => {
  it('时段码按 index 从接口数据回取（表单不持有 code）', () => {
    const payload = buildTargetPayload(buildTargetFormValues(DATA), DATA);
    expect(payload.targets.map((item) => item.timeSlotCode)).toEqual(['FASTING', 'BEDTIME']);
  });

  it('全量提交展示集合内的所有时段，不做增删改分类（后端 diff）', () => {
    const payload = buildTargetPayload(buildTargetFormValues(DATA), DATA);
    expect(payload.targets).toHaveLength(DATA.targets.length);
  });

  it('清空的时段两值都为 null 原样传出 → 后端删除该行，库里不留 null 空壳', () => {
    const values = buildTargetFormValues(DATA);
    values.targets[0] = { valueDown: null, valueUp: null };
    expect(buildTargetPayload(values, DATA).targets[0]).toEqual({
      timeSlotCode: 'FASTING',
      valueDown: null,
      valueUp: null,
    });
  });

  it('undefined 归一成 null：antd 未触碰的字段可能是 undefined，直接传会被 Zod 判为必填', () => {
    const values: TargetFormValues = {
      targets: [{ valueDown: undefined as unknown as null, valueUp: 7 }],
      alert: { lowThreshold: 3.9, highThreshold: 16.7 },
    };
    const payload = buildTargetPayload(values, {
      ...DATA,
      targets: [DATA.targets[0]],
    });
    expect(payload.targets[0].valueDown).toBeNull();
  });

  it('预警值原样传出（必填不可清空，null 交给 Zod 报错而非静默兜底）', () => {
    const values = buildTargetFormValues(DATA);
    values.alert.lowThreshold = null;
    const payload = buildTargetPayload(values, DATA);
    expect(payload.alert.lowThreshold).toBeNull();
  });
});

describe('isTargetFormDirty — 裁定 S 交互 2 取消时二次确认', () => {
  const original = buildTargetFormValues(DATA);

  it('未改动 → false（不该弹确认框打扰医护）', () => {
    expect(isTargetFormDirty(buildTargetFormValues(DATA), original)).toBe(false);
  });

  it('改了一个下限 → true', () => {
    const current = buildTargetFormValues(DATA);
    current.targets[0].valueDown = 4;
    expect(isTargetFormDirty(current, original)).toBe(true);
  });

  it('清空一个已有值 → true（删行也是改动）', () => {
    const current = buildTargetFormValues(DATA);
    current.targets[0] = { valueDown: null, valueUp: null };
    expect(isTargetFormDirty(current, original)).toBe(true);
  });

  it('给缺行时段填了值 → true（新建行也是改动）', () => {
    const current = buildTargetFormValues(DATA);
    current.targets[1] = { valueDown: 5, valueUp: 8.3 };
    expect(isTargetFormDirty(current, original)).toBe(true);
  });

  it('只改预警值 → true', () => {
    const current = buildTargetFormValues(DATA);
    current.alert.highThreshold = 15;
    expect(isTargetFormDirty(current, original)).toBe(true);
  });

  it('长度不同 → true（展示集合在打开期间被改过的极端情况）', () => {
    const current = buildTargetFormValues(DATA);
    current.targets.pop();
    expect(isTargetFormDirty(current, original)).toBe(true);
  });

  it('「恢复默认」后与原值不同 → true（仍需提示未保存，因为默认值≠库中值）', () => {
    const modified: PatientGlucoseTargetsResponse = {
      ...DATA,
      targets: [{ ...DATA.targets[0], valueDown: 4, valueUp: 6 }, DATA.targets[1]],
    };
    const before = buildTargetFormValues(modified);
    const afterRestore = buildDefaultFormValues(modified);
    expect(isTargetFormDirty(afterRestore, before)).toBe(true);
  });
});

describe('canEditGlucoseTarget — R11 / 裁定 W 编辑入口门控', () => {
  it('住院中 + 有 patient:target:update → 可编辑', () => {
    expect(canEditGlucoseTarget(PATIENT_STATUS.INPATIENT, hasTargetPermission)).toBe(true);
  });

  it('已出院 + 有权限 → 不可编辑（只能看不能改，与「添加血糖」按钮同口径）', () => {
    expect(canEditGlucoseTarget(PATIENT_STATUS.DISCHARGED, hasTargetPermission)).toBe(false);
  });

  it('归档 / 未知状态 + 有权限 → 不可编辑：白名单式判断，只认「住院中」', () => {
    // PATIENT_STATUS 常量只有 INPATIENT / DISCHARGED（归档由 archivedAt 表达，不是独立状态值），
    // 故用字面量覆盖「任何非住院中的取值都不可编辑」，避免将来新增状态时被漏判
    expect(canEditGlucoseTarget('ARCHIVED', hasTargetPermission)).toBe(false);
  });

  it('住院中 + 无权限（如 DEVICE_ADMIN）→ 不可编辑', () => {
    expect(canEditGlucoseTarget(PATIENT_STATUS.INPATIENT, hasNoPermission)).toBe(false);
  });

  it('患者详情未加载（status undefined）→ 不可编辑，避免先显示按钮再消失', () => {
    expect(canEditGlucoseTarget(undefined, hasTargetPermission)).toBe(false);
  });
});

describe('parseFieldPath — 后端字段级错误定位到 antd 输入框', () => {
  it('嵌套下标：targets[0].valueDown → ["targets", 0, "valueDown"]（下标必须是 number）', () => {
    expect(parseFieldPath('targets[0].valueDown')).toEqual(['targets', 0, 'valueDown']);
  });

  it('多位数下标不会被截断', () => {
    expect(parseFieldPath('targets[12].valueUp')).toEqual(['targets', 12, 'valueUp']);
  });

  it('对象路径：alert.lowThreshold → ["alert", "lowThreshold"]', () => {
    expect(parseFieldPath('alert.lowThreshold')).toEqual(['alert', 'lowThreshold']);
  });

  it('顶层扁平字段：mealContext → ["mealContext"]（与既有弹框的 path[0] 口径兼容）', () => {
    expect(parseFieldPath('mealContext')).toEqual(['mealContext']);
  });

  it('无法解析（空串）→ 空数组，调用方据此跳过而不是把错误挂到根表单', () => {
    expect(parseFieldPath('')).toEqual([]);
  });
});
