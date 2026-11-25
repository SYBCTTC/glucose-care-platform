import { GLUCOSE_UNIT, PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type {
  PatientGlucoseTargetsResponse,
  PermissionCode,
  UpdatePatientGlucoseTargetsInput,
} from '@gc/shared';

/**
 * 控糖目标的**纯函数**集合（展示文案 / 表单值转换 / 编辑门控）。
 * 规格 `docs/specs/patient-glucose-target.md` §6.2 §6.3、裁定 J / Q / R / S / V / W。
 *
 * 为什么单独成文件：web 测试跑在 **node 环境**（无 jsdom），容器组件依赖
 * `useParams` / `useOutletContext` / 网络请求无法在此渲染，只能靠 typecheck + 手工 e2e；
 * 把全部可判定逻辑抽成纯函数，才能让裁定 R（补 1 位小数）、裁定 V（清空 = 删行）、
 * 裁定 W（编辑门控）这些**口径**被单测钉住。同 `buildReportStatsItems.ts` 的既有做法。
 */

/** 数值展示统一补 1 位小数（裁定 R）：`4.4` → `4.4`、`7` → `7.0`、`5` → `5.0` */
const DECIMALS = 1;

/** 缺行时段的展示文案（裁定 K：显示「未设置」，不显示 0 或空） */
export const NOT_SET_TEXT = '未设置';

/**
 * 单位后缀：直接复用共享包的 `GLUCOSE_UNIT`（存储与提交的唯一单位），不另立字面量——
 * 展示区、弹框输入框后缀、单测断言三处共用同一来源，将来改单位不会漏改。
 */
export const TARGET_UNIT = GLUCOSE_UNIT;

/**
 * 编辑弹框的表单值形状。
 *
 * `targets` 与接口下发的展示集合**等长同序**，只存两个数值 —— 时段码不进表单，
 * 提交时按 index 从接口数据回取（`buildTargetPayload`）。这样 Zod 的 issue path
 * （形如 `['targets', 0, 'valueDown']`）可以**原样**用作 antd `form.setFields` 的 name
 * （antd `NamePath` 支持数组），错误红字才能精确挂到对应输入框。
 *
 * ⚠️ 若把时段码也塞进表单数组，index 与展示集合的对应关系就要额外维护，
 * 一旦排序不一致，错误会挂到别的时段输入框上。
 */
export interface TargetFormValues {
  targets: Array<{ valueDown: number | null; valueUp: number | null }>;
  alert: { lowThreshold: number | null; highThreshold: number | null };
}

/** 时段目标区间文案：`4.4-7.0 mmol/L`；任一值为 null（缺行）→「未设置」（裁定 K） */
export function formatTargetRange(valueDown: number | null, valueUp: number | null): string {
  if (valueDown === null || valueUp === null) {
    return NOT_SET_TEXT;
  }
  return `${valueDown.toFixed(DECIMALS)}-${valueUp.toFixed(DECIMALS)} ${TARGET_UNIT}`;
}

/** 预警值文案：`3.9 mmol/L`；null（该行不存在）→「未设置」 */
export function formatThreshold(value: number | null): string {
  if (value === null) {
    return NOT_SET_TEXT;
  }
  return `${value.toFixed(DECIMALS)} ${TARGET_UNIT}`;
}

/**
 * 接口响应 → 表单初值（打开弹框时回填患者**当前**配置）。
 * 缺行时段的两个输入框为 `null`（空但可填，保存即创建目标行，裁定 S）。
 */
export function buildTargetFormValues(data: PatientGlucoseTargetsResponse): TargetFormValues {
  return {
    targets: data.targets.map((item) => ({
      valueDown: item.valueDown,
      valueUp: item.valueUp,
    })),
    alert: {
      lowThreshold: data.alert.lowThreshold,
      highThreshold: data.alert.highThreshold,
    },
  };
}

/**
 * 「恢复默认」按钮的目标表单值（裁定 S）：时段取 `TimeSlot` 当前默认、预警取全局 `SystemConfig`。
 *
 * ⚠️ **仅重置表单，仍需点保存才落库**（裁定 S 明确），本函数不发请求。
 * 全局阈值缺失时 `defaultLowThreshold/defaultHighThreshold` 为 null（裁定 Q），
 * 此时按钮应整体置灰（`canRestoreDefault`），不会走到这里。
 */
export function buildDefaultFormValues(data: PatientGlucoseTargetsResponse): TargetFormValues {
  return {
    targets: data.targets.map((item) => ({
      valueDown: item.defaultValueDown,
      valueUp: item.defaultValueUp,
    })),
    alert: {
      lowThreshold: data.alert.defaultLowThreshold,
      highThreshold: data.alert.defaultHighThreshold,
    },
  };
}

/**
 * 「恢复默认」按钮是否可用：全局 `SystemConfig` 阈值齐备才可用（裁定 Q）。
 * 缺失时置灰 + tooltip 说明，而不是恢复出一半默认值（半配置会被后端 10001 拒绝）。
 */
export function canRestoreDefault(data: PatientGlucoseTargetsResponse | null): boolean {
  if (!data) {
    return false;
  }
  return data.alert.defaultLowThreshold !== null && data.alert.defaultHighThreshold !== null;
}

/**
 * 表单值 → PATCH 请求体（**全量提交**展示集合内的时段，裁定 N）。
 *
 * 时段码按 index 从接口数据回取（表单不持有 code，见 `TargetFormValues` 注释）。
 * `null` 原样传出：某时段两值都为 null = 后端**删除**该目标行（裁定 V）。
 * antd `InputNumber` 清空后给的正是 `null`，无需额外转换；`undefined` 统一归一成 `null`，
 * 否则 Zod 的 `nullable()` 会拒收 undefined 并报「必填」，与「清空 = 删行」的语义相反。
 */
export function buildTargetPayload(
  values: TargetFormValues,
  data: PatientGlucoseTargetsResponse,
): UpdatePatientGlucoseTargetsInput {
  return {
    targets: data.targets.map((item, index) => {
      const row = values.targets[index];
      return {
        timeSlotCode: item.timeSlotCode,
        valueDown: row?.valueDown ?? null,
        valueUp: row?.valueUp ?? null,
      };
    }),
    alert: {
      // 预警值必填不可清空（§11 待确认项 1 的现行口径）；null 交给 Zod 报错，不在此静默兜底
      lowThreshold: values.alert.lowThreshold as number,
      highThreshold: values.alert.highThreshold as number,
    },
  };
}

/**
 * 表单是否有未保存改动（取消 / 关闭时二次确认用，裁定 S 交互 2）。
 *
 * 逐字段比较而非比较对象引用：antd 表单值每次 `getFieldsValue` 都是新对象，
 * 用 `===` 会恒判为「有改动」，导致每次取消都弹确认框。
 * 数值用 `===` 即可（都是 1 位小数的有限数或 null，无浮点运算，不存在精度漂移）。
 */
export function isTargetFormDirty(current: TargetFormValues, original: TargetFormValues): boolean {
  if (current.targets.length !== original.targets.length) {
    return true;
  }
  for (let index = 0; index < current.targets.length; index += 1) {
    const now = current.targets[index];
    const before = original.targets[index];
    if (now.valueDown !== before.valueDown || now.valueUp !== before.valueUp) {
      return true;
    }
  }
  return (
    current.alert.lowThreshold !== original.alert.lowThreshold ||
    current.alert.highThreshold !== original.alert.highThreshold
  );
}

/**
 * 后端字段级错误的 `field` 字符串 → antd `form.setFields` 需要的 `NamePath` 数组。
 *
 * 后端（`patient-glucose-target.service.ts` 的 `assertCodesInDisplaySet`）与共享 Zod 契约
 * 都用 `targets[0].valueDown` 这种「点 + 方括号」混合写法定位嵌套字段，而 antd 要的是
 * `['targets', 0, 'valueDown']`（数组元素为下标时必须是 **number**，字符串 `'0'` 匹配不上
 * `Form.Item name={['targets', 0, 'valueDown']}`，红字会挂空）。
 *
 * 既有的 `GlucoseCreateModal` 只取 `issue.path[0]`（那批字段都是顶层扁平的），
 * 本需求的字段是嵌套的，故必须有这一层转换。无法解析时返回空数组，调用方据此跳过
 * （宁可少挂一处红字，也不能把错误挂到错误的输入框上误导医护）。
 */
export function parseFieldPath(field: string): Array<string | number> {
  const path: Array<string | number> = [];
  // 逐个 token 匹配：普通段名，或 [数字] 下标
  const pattern = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null = pattern.exec(field);
  while (match !== null) {
    if (match[1] !== undefined) {
      path.push(match[1]);
    } else {
      path.push(Number(match[2]));
    }
    match = pattern.exec(field);
  }
  return path;
}

/**
 * 编辑入口门控（R11 / 裁定 W）：**住院中** + 有 `patient:target:update` 权限。
 * 与详情页壳的「添加血糖」按钮（`index.tsx` 的 `canAddGlucose`）完全同口径。
 *
 * 出院 / 归档患者**只能看不能改**（按钮不渲染）；`DEVICE_ADMIN` 无该权限点同样不渲染。
 * 前端隐藏只是体验，后端为权威（跨科室 30002、非在院 40004、无权限 30004）。
 *
 * `hasPermission` 的参数类型必须是 `PermissionCode` 而**不是** `string`：
 * `useAuthStore` 的签名是 `(permission: PermissionCode) => boolean`，函数参数是逆变位置，
 * 声明成更宽的 `string` 会让 store 的方法无法赋进来（TS2345）。
 */
export function canEditGlucoseTarget(
  patientStatus: string | undefined,
  hasPermission: (permission: PermissionCode) => boolean,
): boolean {
  return (
    patientStatus === PATIENT_STATUS.INPATIENT && hasPermission(PERMISSION.PATIENT_TARGET_UPDATE)
  );
}
