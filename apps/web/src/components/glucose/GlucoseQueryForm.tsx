import type { ReactNode } from 'react';
import { Button, DatePicker, Select, theme } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { PATIENT_STATUS } from '@gc/shared';
import type { AdmissionDepartmentOption, AdmissionOption, AdmissionsResponse } from '@gc/shared';

/**
 * 血糖数据三页共用的**查询表单**（公共四项 + `extra` 扩展插槽）。
 *
 * 来源：R24 报表查询表单（2026-11-20 需求人 18 项裁定，规格 docs/specs/glucose-report-query.md），
 * 2026-11-20 提升为公共模块——血糖记录 / 趋势图两页需要同一套「住院记录 → 科室记录 →
 * 时间范围」联动，三页各写一遍必然漂移（尤其时间上下限的三层回退与边界日时分秒禁用）。
 *
 * 联动状态机（§4）：住院记录 → 决定科室下拉选项集；科室记录 → 决定时间默认值与上下限；
 * 「查询」才把表单态应用为请求范围（改表单不触发请求）。
 * 本文件 = 纯函数（联动推导，导出供单测）+ 受控展示组件（状态由调用页持有）。
 *
 * **不取数**：住院记录树由调用页用 `useAdmissions` 拉取后传入，本组件不发请求——
 * 公共组件一旦自己取数，三页就会各发一次相同请求，且无法在占位页保持「不发请求」约定。
 */

/** 秒粒度本地时间格式（与服务端 dateTimeStringSchema 契约一致） */
export const QUERY_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
/** 「全部」选项的哨兵值（真实住院 id 是 uuid，不会冲突） */
export const ADMISSION_ALL = 'ALL';

/** 表单状态：admissionId 'ALL' = 全部；departmentStayId null = 已清空（裁定 Q11） */
export interface GlucoseQueryFormState {
  admissionId: string;
  departmentStayId: string | null;
  /** YYYY-MM-DD HH:mm:ss；null = 不限（裁定 Q13 允许单独清空） */
  startTime: string | null;
  endTime: string | null;
}

/** 查询范围（`toQueryRange` 的产出）：字段缺省 = 该侧不限 */
export interface GlucoseQueryRange {
  startTime?: string;
  endTime?: string;
}

/** 「全部 + 无限制」态：出院患者初始态（裁定 Q15），也是 admissions 请求失败的退化态 */
export const FALLBACK_FORM_STATE: GlucoseQueryFormState = {
  admissionId: ADMISSION_ALL,
  departmentStayId: null,
  startTime: null,
  endTime: null,
};

/* ------------------------------ 纯函数（联动推导） ------------------------------ */

function findAdmission(data: AdmissionsResponse, admissionId: string): AdmissionOption | null {
  return data.admissions.find((item) => item.id === admissionId) ?? null;
}

function findStay(data: AdmissionsResponse, stayId: string): AdmissionDepartmentOption | null {
  for (const admission of data.admissions) {
    const stay = admission.departments.find((item) => item.id === stayId);
    if (stay) {
      return stay;
    }
  }
  return null;
}

/** 本次住院的默认科室 = 进行中停留（endedAt null）；历史住院 = 第一条（入院科室，裁定 Q9） */
function defaultStayOf(admission: AdmissionOption): AdmissionDepartmentOption | null {
  if (admission.isCurrent) {
    return (
      admission.departments.find((stay) => stay.endedAt === null) ??
      admission.departments[0] ??
      null
    );
  }
  return admission.departments[0] ?? null;
}

/**
 * 初始默认态（裁定 Q15：初始加载即按默认条件查询）：
 *  - 在院 → 「本次住院」+ 当前所在科室 + 该科室起止（在科则结束为空）；
 *  - 出院 / 无本次住院记录（防御）→ 「全部」+ 无限制。
 */
export function deriveQueryDefaults(data: AdmissionsResponse): GlucoseQueryFormState {
  if (data.status === PATIENT_STATUS.INPATIENT) {
    const current = data.admissions.find((item) => item.isCurrent);
    if (current) {
      const stay = defaultStayOf(current);
      return {
        admissionId: current.id,
        departmentStayId: stay?.id ?? null,
        startTime: stay?.startedAt ?? null,
        endTime: stay?.endedAt ?? null,
      };
    }
  }
  return { ...FALLBACK_FORM_STATE };
}

/**
 * 切换住院记录（需求规则 2/3）：
 *  - 「全部」→ 科室选中值清空、选项集 = 跨住院平铺（组件侧），时间清空无限制（裁定 Q10/Q11）；
 *  - 某次住院 → 科室默认选中（本次 = 进行中；历史 = 第一条，裁定 Q9），时间 = 该科室起止。
 */
export function deriveAdmissionSelection(
  data: AdmissionsResponse,
  admissionId: string,
): GlucoseQueryFormState {
  if (admissionId === ADMISSION_ALL) {
    return { ...FALLBACK_FORM_STATE };
  }
  const admission = findAdmission(data, admissionId);
  if (!admission) {
    return { ...FALLBACK_FORM_STATE };
  }
  const stay = defaultStayOf(admission);
  return {
    admissionId,
    departmentStayId: stay?.id ?? null,
    startTime: stay?.startedAt ?? null,
    endTime: stay?.endedAt ?? null,
  };
}

/**
 * 切换/清空科室记录（需求规则 3/4/5）：
 *  - 选中某条（含「全部」场景，裁定 Q10）→ 时间 = 该记录起止（在科则结束为空）；
 *  - 清空（裁定 Q11 + §11-1）→ 时间回退为所选住院记录起止；「全部」则清空、无限制。
 */
export function deriveStaySelection(
  data: AdmissionsResponse,
  state: GlucoseQueryFormState,
  stayId: string | null,
): GlucoseQueryFormState {
  if (stayId === null) {
    if (state.admissionId === ADMISSION_ALL) {
      return { ...state, departmentStayId: null, startTime: null, endTime: null };
    }
    const admission = findAdmission(data, state.admissionId);
    return {
      ...state,
      departmentStayId: null,
      startTime: admission?.admittedAt ?? null,
      endTime: admission?.dischargedAt ?? null,
    };
  }
  const stay = findStay(data, stayId);
  return {
    ...state,
    departmentStayId: stayId,
    startTime: stay?.startedAt ?? null,
    endTime: stay?.endedAt ?? null,
  };
}

/**
 * 时间控件上下限（裁定 Q12，§4.4 三层回退）：科室记录 > 住院记录 > 无限制。
 * 「进行中」（endedAt/dischargedAt 为空）上限 = 今天 23:59:59。
 */
export function deriveTimeBounds(
  data: AdmissionsResponse,
  state: GlucoseQueryFormState,
): { min: Dayjs | null; max: Dayjs | null } {
  const endOfToday = () => dayjs().endOf('day');
  const toBounds = (start: string | null, end: string | null) => ({
    min: start ? dayjs(start, QUERY_TIME_FORMAT) : null,
    max: end ? dayjs(end, QUERY_TIME_FORMAT) : endOfToday(),
  });

  if (state.departmentStayId !== null) {
    const stay = findStay(data, state.departmentStayId);
    if (stay) {
      return toBounds(stay.startedAt, stay.endedAt);
    }
  }
  if (state.admissionId !== ADMISSION_ALL) {
    const admission = findAdmission(data, state.admissionId);
    if (admission) {
      return toBounds(admission.admittedAt, admission.dischargedAt);
    }
  }
  return { min: null, max: null };
}

/** 住院记录 label（裁定 Q5/Q7）：本次住院 / `第N次 (YYYY-MM-DD ~ YYYY-MM-DD)` / 日期空则省略区间 */
export function buildAdmissionLabel(admission: AdmissionOption): string {
  if (admission.isCurrent) {
    return '本次住院';
  }
  const prefix = `第${admission.seq}次`;
  if (admission.admittedAt && admission.dischargedAt) {
    return `${prefix} (${admission.admittedAt.slice(0, 10)} ~ ${admission.dischargedAt.slice(0, 10)})`;
  }
  return prefix;
}

/** 科室记录 label（裁定 Q8）：`科室名 (起 ~ 止)`；进行中 `科室名 (起 ~ 至今)`；空日期省略对应部分 */
export function buildDepartmentLabel(stay: AdmissionDepartmentOption): string {
  const start = stay.startedAt?.slice(0, 10);
  const end = stay.endedAt?.slice(0, 10);
  if (start && end) {
    return `${stay.departmentName} (${start} ~ ${end})`;
  }
  if (start) {
    return `${stay.departmentName} (${start} ~ 至今)`;
  }
  if (end) {
    return `${stay.departmentName} (~ ${end})`;
  }
  return stay.departmentName;
}

/** 住院下拉选项：接口已按 admittedAt 降序（裁定 Q6），保持原序；「全部」恒为末项 */
export function buildAdmissionOptions(
  data: AdmissionsResponse,
): { value: string; label: string }[] {
  return [
    ...data.admissions.map((admission) => ({
      value: admission.id,
      label: buildAdmissionLabel(admission),
    })),
    { value: ADMISSION_ALL, label: '全部' },
  ];
}

/**
 * 科室下拉选项：选中某次住院 → 该住院的停留（升序）；「全部」→ 跨住院平铺
 * （每段停留一条、各带区间，跨住院同科室出现多条属正常，需求规则 3）。
 */
export function buildDepartmentOptions(
  data: AdmissionsResponse,
  admissionId: string,
): { value: string; label: string }[] {
  const source =
    admissionId === ADMISSION_ALL
      ? data.admissions
      : data.admissions.filter((admission) => admission.id === admissionId);
  return source.flatMap((admission) =>
    admission.departments.map((stay) => ({
      value: stay.id,
      label: buildDepartmentLabel(stay),
    })),
  );
}

/** 表单态 → 查询范围（null → undefined = 该侧不限）。三页共用同一套时间参数契约 */
export function toQueryRange(state: GlucoseQueryFormState): GlucoseQueryRange {
  return {
    startTime: state.startTime ?? undefined,
    endTime: state.endTime ?? undefined,
  };
}

/** 开始 > 结束（裁定 Q13：阻止查询）。定宽格式字典序即时间序，直接字符串比较 */
export function isRangeInverted(state: GlucoseQueryFormState): boolean {
  return Boolean(state.startTime && state.endTime && state.startTime > state.endTime);
}

/* ------------------------------ 受控组件 ------------------------------ */

/** 连续整数数组 [start, end)，antd disabledHours/Minutes/Seconds 用 */
function intRange(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
}

/**
 * 边界日的时分秒禁用（配合 disabledDate 的日级禁用）：
 * 选中日 = 下限日 → 禁早于下限的时/分/秒；= 上限日 → 禁晚于上限的时/分/秒。
 */
function disabledTimeAt(bound: Dayjs, edge: 'min' | 'max') {
  return () => ({
    disabledHours: () =>
      edge === 'min' ? intRange(0, bound.hour()) : intRange(bound.hour() + 1, 24),
    disabledMinutes: (hour: number) =>
      hour === bound.hour()
        ? edge === 'min'
          ? intRange(0, bound.minute())
          : intRange(bound.minute() + 1, 60)
        : [],
    disabledSeconds: (hour: number, minute: number) =>
      hour === bound.hour() && minute === bound.minute()
        ? edge === 'min'
          ? intRange(0, bound.second())
          : intRange(bound.second() + 1, 60)
        : [],
  });
}

/** 下拉/时间控件宽度：label 较长（`第N次 (YYYY-MM-DD ~ YYYY-MM-DD)`），非 token 档位故立常量 */
const ADMISSION_SELECT_WIDTH = 250;
const DEPARTMENT_SELECT_WIDTH = 250;
const TIME_PICKER_WIDTH = 195;

export interface GlucoseQueryFormProps {
  /** 住院记录树；null = 尚未就绪（表单禁用） */
  data: AdmissionsResponse | null;
  loading: boolean;
  /** 当前表单态；null = 尚未初始化 */
  state: GlucoseQueryFormState | null;
  onChange: (next: GlucoseQueryFormState) => void;
  onSearch: () => void;
  onReset: () => void;
  /**
   * 各页特有的追加条件，渲染在时间控件之后、「查询/重置」按钮之前。
   *
   * 为什么用插槽而不是把字段做进公共组件：三页的筛选维度不同（记录页可能要
   * 时段/结果类型/录入人/含作废，趋势图可能要粒度/指标），全塞进公共组件会让
   * props 膨胀成配置地狱，且任一页改动都要三页回归。插槽让公共部分稳定、
   * 特有部分各页自理；按钮恒在最右，视觉顺序一致。
   */
  extra?: ReactNode;
  /**
   * R28：打印入口。不传 = 不渲染打印按钮（权限门控在调用页：无 `glucose:print`
   * 就不传，前端显隐只是体验，打印相关接口由服务端强制校验兜底，裁定 Q6）。
   * 按钮排在「重置」之后，与「查询」同类型（type="primary"，需求第 1 条）。
   */
  onPrint?: () => void;
  /** R28：已应用范围内无数据 → 打印按钮禁用（裁定 B3；数据门控由调用页判定） */
  printDisabled?: boolean;
}

/**
 * 查询表单（工具栏行内，裁定 Q18a：接受换行；打印隐藏，同 `FullscreenToggle` 口径）。
 * 受控组件：状态与联动推导都在调用页，本组件只做渲染与事件转发。
 */
export function GlucoseQueryForm({
  data,
  loading,
  state,
  onChange,
  onSearch,
  onReset,
  extra,
  onPrint,
  printDisabled,
}: GlucoseQueryFormProps) {
  const { token } = theme.useToken();
  const disabled = data === null || state === null;

  const admissionOptions = data ? buildAdmissionOptions(data) : [];
  const departmentOptions = data && state ? buildDepartmentOptions(data, state.admissionId) : [];
  const bounds = data && state ? deriveTimeBounds(data, state) : { min: null, max: null };

  const disabledDate = (current: Dayjs) => {
    if (bounds.min && current.isBefore(bounds.min, 'day')) {
      return true;
    }
    if (bounds.max && current.isAfter(bounds.max, 'day')) {
      return true;
    }
    return false;
  };

  const timePickerProps = (edge: 'min' | 'max') => ({
    disabledDate,
    disabledTime: (current: Dayjs | null) => {
      const bound = edge === 'min' ? bounds.min : bounds.max;
      if (!bound || !current || !current.isSame(bound, 'day')) {
        return {};
      }
      return disabledTimeAt(bound, edge)();
    },
  });

  return (
    <div
      className="gc-no-print"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: token.marginXS,
        flexWrap: 'wrap',
      }}
    >
      <Select
        aria-label="住院记录"
        style={{ width: ADMISSION_SELECT_WIDTH }}
        placeholder="住院记录"
        loading={loading}
        disabled={disabled}
        options={admissionOptions}
        value={state?.admissionId}
        onChange={(value: string) => {
          if (data) {
            onChange(deriveAdmissionSelection(data, value));
          }
        }}
      />
      <Select
        aria-label="科室记录"
        style={{ width: DEPARTMENT_SELECT_WIDTH }}
        placeholder="科室记录"
        allowClear
        loading={loading}
        disabled={disabled}
        options={departmentOptions}
        value={state?.departmentStayId ?? undefined}
        onChange={(value: string | undefined) => {
          if (data && state) {
            onChange(deriveStaySelection(data, state, value ?? null));
          }
        }}
      />
      <DatePicker
        aria-label="开始时间"
        style={{ width: TIME_PICKER_WIDTH }}
        showTime
        format={QUERY_TIME_FORMAT}
        placeholder="开始时间"
        disabled={disabled}
        value={state?.startTime ? dayjs(state.startTime, QUERY_TIME_FORMAT) : null}
        onChange={(value) => {
          if (state) {
            onChange({
              ...state,
              startTime: value ? value.format(QUERY_TIME_FORMAT) : null,
            });
          }
        }}
        {...timePickerProps('min')}
      />
      <DatePicker
        aria-label="结束时间"
        style={{ width: TIME_PICKER_WIDTH }}
        showTime
        format={QUERY_TIME_FORMAT}
        placeholder="结束时间"
        disabled={disabled}
        value={state?.endTime ? dayjs(state.endTime, QUERY_TIME_FORMAT) : null}
        onChange={(value) => {
          if (state) {
            onChange({
              ...state,
              endTime: value ? value.format(QUERY_TIME_FORMAT) : null,
            });
          }
        }}
        {...timePickerProps('max')}
      />
      {extra}
      <Button type="primary" disabled={disabled} onClick={onSearch}>
        查询
      </Button>
      <Button disabled={disabled} onClick={onReset}>
        重置
      </Button>
      {/* R28：打印按钮（重置之后、与查询同类型）；onPrint 未传 = 无权限，不渲染（裁定 Q6） */}
      {onPrint ? (
        <Button type="primary" disabled={disabled || printDisabled} onClick={onPrint}>
          打印
        </Button>
      ) : null}
    </div>
  );
}
