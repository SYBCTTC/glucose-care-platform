/**
 * 患者详情页的**子路径与 Tab 派生规则**——唯一来源。
 *
 * 为什么集中：详情页有 5 个内容页（基本信息 / 出入院记录 / 血糖报告 / 血糖记录 / 趋势图），
 * 每条子路径都要在 `routes.tsx`（登记路由）与 `PatientDetailTabs.tsx`（派生高亮 + 跳转）各用一次。
 * 两处各写字面量，改一处忘另一处就会出现「Tab 高亮与实际内容不符」，
 * 或跳到不存在的路由 → 命中 `*` 兜底 → 用户莫名其妙被弹回血糖报告。
 */

/** 详情页路由 path（`routes.tsx` 登记用） */
export const DETAIL_ROUTE_PATH = '/inpatient/patients/:id';

/** 详情页 URL 前缀（拼绝对路径用；与 DETAIL_ROUTE_PATH 的静态部分保持一致） */
export const DETAIL_PATH_PREFIX = '/inpatient/patients/';

/** 主 Tab key（下划线高亮） */
export type DetailMainTab = 'glucose' | 'basic' | 'admission';

/** 「血糖数据」下的子 Tab key（背景色高亮） */
export type DetailGlucoseTab = 'report' | 'record' | 'trend';

/**
 * 子路径常量。均为**相对**父路由的 path（React Router 要求子路由 path 不以 `/` 开头）。
 * 血糖三子页用两段路径 `glucose/xxx`，这样 URL 层级与两层 Tab 的视觉层级一致。
 */
export const DETAIL_TAB_PATH = {
  basic: 'basic',
  admission: 'admission',
  glucoseReport: 'glucose/report',
  glucoseRecord: 'glucose/record',
  glucoseTrend: 'glucose/trend',
} as const;

/** 进入详情页的默认落点（需求 1：默认高亮「血糖数据 → 血糖报告」） */
export const DETAIL_DEFAULT_TAB: string = DETAIL_TAB_PATH.glucoseReport;

/** 主 Tab key → 该 Tab 的代表性子路径。「血糖数据」落到默认子页 report */
export const MAIN_TAB_PATH: Record<DetailMainTab, string> = {
  glucose: DETAIL_TAB_PATH.glucoseReport,
  basic: DETAIL_TAB_PATH.basic,
  admission: DETAIL_TAB_PATH.admission,
};

/** 血糖子 Tab key → 子路径 */
export const GLUCOSE_TAB_PATH: Record<DetailGlucoseTab, string> = {
  report: DETAIL_TAB_PATH.glucoseReport,
  record: DETAIL_TAB_PATH.glucoseRecord,
  trend: DETAIL_TAB_PATH.glucoseTrend,
};

/** 当前选中的 Tab（由 URL 派生，不再用组件内 state） */
export interface DetailTabState {
  main: DetailMainTab;
  glucose: DetailGlucoseTab;
}

/**
 * 父路由通过 `<Outlet context>` 传给子页的内容。
 *
 * `glucoseVersion`：详情页壳里的「添加血糖」成功后自增，血糖报告据此重新拉取。
 * 录入弹窗挂在壳上、报表数据在子路由里，两者不同层，故走 Outlet context 打通；
 * 没有它，添加血糖后报表会停在旧数据上。
 */
export interface DetailOutletContext {
  glucoseVersion: number;
}

/**
 * R22：血糖报告**展示项勾选**（子 Tabs 行尾随的四个 Checkbox，2026-11-19 需求人裁定）。
 *
 * 纯前端视图过滤：不重新请求接口，统计栏与分页 total 不受影响（裁定 Q5）。
 * 状态由 `PatientDetailTabs` 持有——勾选框 UI 在子 Tabs 行、报表内容在子路由层，
 * 经 Outlet context（`DetailChildContext`）打通；详情页会话内记忆，
 * 换患者/重新进入详情页重置为全勾选（裁定 Q8），不做持久化。
 */
export interface GlucoseReportDisplay {
  /** 常规血糖：普通时段来源记录的显隐（裁定 Q3：控记录不控列；弃用记录按原类型跟随，裁定 Q4） */
  normal: boolean;
  /** 强化血糖：强化时段来源记录（带强化后缀）的显隐 */
  intensive: boolean;
  /** 检测时间：格内 `(HH:mm)` 的显隐；特殊时段来源记录的时间恒展示（规则 6） */
  time: boolean;
  /** 操作人：第二行记录者的显隐（对含特殊时段在内的所有记录生效，规则 6「其他几个继续受控」） */
  operator: boolean;
}

/** 展示项勾选默认值：全勾选（规则 3「常规/强化至少一项」天然满足） */
export const DEFAULT_GLUCOSE_REPORT_DISPLAY: GlucoseReportDisplay = {
  normal: true,
  intensive: true,
  time: true,
  operator: true,
};

/** `PatientDetailTabs` 合并后传给内容页的 context：父级 context + R22 展示勾选 */
export interface DetailChildContext extends DetailOutletContext {
  reportDisplay: GlucoseReportDisplay;
}

/** 详情页内 Tab 跳转的目标与选项（`useDetailTabNavigate` 的纯逻辑部分） */
export interface DetailTabNavigation {
  to: string;
  options: { replace: boolean; state: unknown };
}

/**
 * 构造详情页内 Tab 跳转的目标与选项。抽成纯函数是为了让两个**必须同时满足**的约束可被单测钉住
 * （web 测试跑在 node 环境，hook 的 onChange 无法触发，只能测这层）：
 *
 *  1. `replace: true`（R15）：Tab 切换不追加历史条目。否则连点几个 Tab 后历史栈变成
 *     `列表 → report → basic → trend …`，用户点「返回」/浏览器后退会在 Tab 间逐级打转、回不到列表。
 *  2. `state` 原样透传：`index.tsx` 的 `handleBack` 靠 `location.state.from` 决定
 *     `navigate(-1)`（精确还原来源页）还是兜底跳患者管理。`replace` 会用新条目**覆盖**当前条目，
 *     不带上 state 就等于清空它——从虚拟病区进来的用户会被送回患者管理，
 *     列表页的 Tab/筛选/页码快照（`list-nav-state`）也一并失效。
 */
export function buildDetailTabNavigation(
  id: string | undefined,
  subPath: string,
  state: unknown,
): DetailTabNavigation {
  return {
    to: `${DETAIL_PATH_PREFIX}${id}/${subPath}`,
    options: { replace: true, state },
  };
}

const DEFAULT_TAB_STATE: DetailTabState = { main: 'glucose', glucose: 'report' };

/**
 * 从 pathname 派生当前选中的主/子 Tab。纯函数，单测见 `detail-tabs.spec.ts`。
 *
 * 无法识别时（裸详情 URL、未知子路径）回落到默认值「血糖数据 → 血糖报告」，
 * 与 index / `*` 兜底路由的重定向目标一致——即使重定向还没生效，
 * Tab 高亮也不会出现「两个都不亮」的空档。
 */
export function resolveDetailTab(pathname: string): DetailTabState {
  if (!pathname.startsWith(DETAIL_PATH_PREFIX)) {
    return { ...DEFAULT_TAB_STATE };
  }

  // rest = '<id>' 或 '<id>/<子路径>'
  const rest = pathname.slice(DETAIL_PATH_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return { ...DEFAULT_TAB_STATE };
  }

  // 去掉可能的尾斜杠，避免 'basic/' 匹配不上
  const sub = rest.slice(slash + 1).replace(/\/+$/, '');

  switch (sub) {
    case DETAIL_TAB_PATH.basic:
      return { main: 'basic', glucose: 'report' };
    case DETAIL_TAB_PATH.admission:
      return { main: 'admission', glucose: 'report' };
    case DETAIL_TAB_PATH.glucoseReport:
      return { main: 'glucose', glucose: 'report' };
    case DETAIL_TAB_PATH.glucoseRecord:
      return { main: 'glucose', glucose: 'record' };
    case DETAIL_TAB_PATH.glucoseTrend:
      return { main: 'glucose', glucose: 'trend' };
    default:
      // 未知子路径：`*` 兜底路由会重定向到默认页，这里同样回落默认值
      return { ...DEFAULT_TAB_STATE };
  }
}
