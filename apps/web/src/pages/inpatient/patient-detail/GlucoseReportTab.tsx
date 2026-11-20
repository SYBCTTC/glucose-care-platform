import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Alert, Button, Table, Typography, message, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useOutletContext, useParams } from 'react-router-dom';
import {
  DICT_TYPE,
  GLUCOSE_REPORT_PAGE_SIZE,
  GLUCOSE_RESULT_CODE_HIGH,
  GLUCOSE_RESULT_CODE_LOW,
  TIME_SLOT_CATEGORY,
} from '@gc/shared';
import type {
  DictItemOption,
  GlucoseReportCell,
  GlucoseReportEntry,
  GlucoseReportRow,
  GlucoseReportStats,
} from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';
import type { DetailChildContext, GlucoseReportDisplay } from './detail-tabs';
import { useGlucoseReport } from './useGlucoseReport';
import type { GlucoseReportRange } from './useGlucoseReport';
import { useAdmissions } from './useAdmissions';
import {
  FALLBACK_FORM_STATE,
  ReportQueryForm,
  deriveQueryDefaults,
  isRangeInverted,
  toReportRange,
} from './ReportQueryForm';
import type { ReportQueryFormState } from './ReportQueryForm';

/** 日期列宽提示：容纳 `YYYY-MM-DD` 等宽数字；时段列不定宽，均分剩余空间（2026-11-19 二次调整：不横向滚动） */
const DATE_COLUMN_WIDTH = 116;
/** 值行内间距：需求人明确指定 6px（2026-11-19 三次调整），非 token 档位故立常量注明出处 */
const VALUE_GAP_PX = 6;
/** 统计栏段落间距：需求人明确指定 20px（R20），非 token 档位故立常量注明出处 */
const STATS_GAP_PX = 20;
/**
 * 表格区最小高度（R21）：极矮视口下的防塌缩兜底。
 * 正常视口由 flex 链自动占满剩余空间；空间不足此值时根节点退化为内部滚动。
 */
const REPORT_TABLE_MIN_HEIGHT = 200;

/**
 * 字典缺失时的稳定空值。必须是**模块级常量**：
 * 若在 selector 里写 `?? []`，每次调用都产生新数组，zustand 用 `Object.is` 比较会判定
 * "状态变了" → 无限重渲染。
 */
const EMPTY_RESULT_TYPES: DictItemOption[] = [];

/**
 * 血糖报告单元格。
 *
 * 每条记录**两行**（R3，需求人变更后的口径）：
 *  - 第 1 行 `{值或标签}[(HH:mm)][(来源时段名)]`——后缀为强化时段名或弃用时段名（R22）；
 *  - 第 2 行 记录者姓名。
 * 同日同时段多条 → 纵向堆叠，组间加分隔线（R4）。
 *
 * R22 展示项勾选（`display`，2026-11-19 裁定）：
 *  - `time=false` → 隐藏 `(HH:mm)`；但**特殊时段来源的记录时间恒展示**（规则 6，
 *    含弃用的特殊时段——按原时段类型跟随，裁定 Q4）；
 *  - `operator=false` → 隐藏第 2 行记录者（对含特殊时段在内的所有记录生效）。
 *
 * 括号一律**英文半角、紧邻无空格**；着色只作用于「值/标签」部分，
 * 时间与后缀名用正文色（D4）——整行染色会让时间也带上告警色，读起来像异常值。
 */
/**
 * 导出仅为单测（`GlucoseReportTab.spec.tsx`）：单元格的渲染口径是 R3/R4/R22 的验收主体，
 * 而外层组件依赖 Outlet context 与网络请求，在 node 测试环境里跑不起来。
 *
 * `resultTypes` 由父组件读一次 store 后传下来，而不是在这里各自订阅：
 * 一张表最多 15 行 × 10 列 = 150 个单元格，逐个订阅 store 既浪费，
 * 也让组件无法脱离 Zustand 渲染（zustand v5 的服务端快照返回**初始** state，
 * `renderToStaticMarkup` 里读不到测试塞进去的字典）。
 */
export function ReportCell({
  cell,
  resultTypes,
  display,
}: {
  cell: GlucoseReportCell | undefined;
  /** DY-RESULT 字典项，用于取标签与色值 */
  resultTypes: DictItemOption[];
  /** R22 展示项勾选（常规/强化的记录显隐由 filterReportRows 在行级处理，这里只管时间/操作人） */
  display: GlucoseReportDisplay;
}) {
  const { token } = theme.useToken();

  // 2026-11-19 二次调整：无数据的格子渲染为空，不放 `-` 占位
  if (!cell?.entries.length) {
    return null;
  }

  const separatorStyle = {
    marginTop: token.paddingXS,
    paddingTop: token.paddingXS,
    borderTop: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
  };

  return (
    <div>
      {cell.entries.map((entry: GlucoseReportEntry, index: number) => {
        const dict = resultTypes.find((option) => option.code === entry.resultType);
        // 判定"是否数值型"以 valueMmolL 为准，不在前端复制 VALUE_RESULT_CODES 码集
        // （否则与 LastGlucose.tsx 形成第二份实现，两处口径迟早漂移）
        const text =
          entry.valueMmolL === null ? (dict?.label ?? entry.resultType) : entry.valueMmolL.toFixed(1);
        // 规则 6：特殊时段来源（含弃用的特殊时段、归组失败兜底）时间恒展示，不受「检测时间」勾选控制
        const showTime = display.time || entry.sourceType === TIME_SLOT_CATEGORY.SPECIAL;

        return (
          <div key={`${entry.time}-${index}`} style={index > 0 ? separatorStyle : undefined}>
            {/* gc-num 提供等宽数字；其默认右对齐被 inline center 覆盖（2026-11-19 二次调整：格内居中）。
                不设 nowrap：列宽均分页面时允许括号段换行，保证表格不横向滚动。
                间距（2026-11-19 三次调整，需求人指定 6px）：`值` 与 `(时间)` 之间恒有间距；
                有来源时段名时 `(时间)` 与 `(名称)` 之间同样加间距。
                用 margin 而非空格字符：文本口径仍是「紧邻无空格」（R3），且 inline margin 不破坏居中 */}
            <div className="gc-num" style={{ textAlign: 'center' }}>
              <span style={{ color: dict?.color ?? undefined }}>{text}</span>
              {showTime ? <span style={{ marginLeft: VALUE_GAP_PX }}>({entry.time})</span> : null}
              {entry.sourceSlotName ? (
                <span style={{ marginLeft: VALUE_GAP_PX }}>({entry.sourceSlotName})</span>
              ) : null}
            </div>
            {display.operator ? (
              <div style={{ color: token.colorTextSecondary }}>{entry.nurseName ?? '-'}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * R22：按展示项勾选过滤单元格记录（规则 4：勾选变化实时生效）。
 *
 * **纯前端过滤，不重新请求接口**（裁定 Q5：统计栏与分页 total 不受影响）：
 *  - 常规/强化来源的记录受各自勾选控制（裁定 Q3：控记录显隐、不控列显隐——
 *    取消「常规血糖」后普通列仍在，强化/合并记录还要落在这些列里）；
 *  - 弃用时段来源的记录按**原时段类型**跟随勾选（裁定 Q4）；
 *  - 特殊时段来源（含归组失败兜底）恒展示（规则 6）；
 *  - 记录全被过滤的日期行**保留为空行**（裁定 Q6：分页 total 由服务端按日期数计算，
 *    前端抽行会造成页内行数与总数不一致）。
 *
 * 常规+强化都勾选时返回原引用，避免无谓拷贝。导出仅为单测。
 */
export function filterReportRows(
  rows: GlucoseReportRow[],
  display: GlucoseReportDisplay,
): GlucoseReportRow[] {
  if (display.normal && display.intensive) {
    return rows;
  }
  return rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => ({
      ...cell,
      entries: cell.entries.filter((entry) => {
        if (entry.sourceType === TIME_SLOT_CATEGORY.INTENSIVE) {
          return display.intensive;
        }
        if (entry.sourceType === TIME_SLOT_CATEGORY.NORMAL) {
          return display.normal;
        }
        return true;
      }),
    })),
  }));
}

/**
 * R23（2026-11-20 需求人提出）：全屏切换按钮。
 *
 * 挂在统计栏行右侧（该行本就是 space-between 且右侧预留，R20）。图标 + 文字双通道
 * （ui-design-tokens 规则 5 的可达性口径），图标用 @ant-design/icons（规则 10）。
 * 打印时隐藏（交互控件对纸质输出无意义）。导出仅为单测（同 ReportCell 的理由）。
 */
export function FullscreenToggle({
  fullscreen,
  onToggle,
}: {
  fullscreen: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Button
      className="gc-no-print"
      type="text"
      size="small"
      icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      onClick={() => onToggle(!fullscreen)}
      // marginLeft auto：统计栏未加载（data 为 null）时按钮仍靠右，避免布局跳动
      style={{ marginLeft: 'auto', flexShrink: 0 }}
    >
      {fullscreen ? '退出全屏' : '全屏'}
    </Button>
  );
}

/**
 * 报表统计栏（R20，2026-11-19 需求人裁定）：替代原「单位：mmol/L」标注
 * （D5 被推翻：格内数值不再有单位标注，单位只随最高/最低值的后缀出现）。
 *
 * 格式：`总计：N 次 ←20px→ | ←20px→ 合格次数：M 次 ←20px→ 最高血糖：X ←20px→ 最低血糖：Y`，左对齐。
 * 统计数由**服务端按查询范围全量计算**（与分页无关），本组件纯展示：
 *  - 最高/最低：`hasHigh`/`hasLow` → 展示 `DY-RESULT` 字典 label（禁止硬编码文案/色值）；
 *    否则数值 `toFixed(1)` + ` mmol/L`，按**该极值自身 resultType** 的字典色着色（裁定 2）；
 *    两者皆无 → `-`（裁定 3a：总计为 0 时统计栏照常展示）。
 *
 * 导出仅为单测（同 `ReportCell` 的理由：外层组件依赖 Outlet context 与网络请求）。
 */
export function ReportStatsBar({
  stats,
  resultTypes,
}: {
  stats: GlucoseReportStats;
  /** DY-RESULT 字典项，用于取 High/Low 标签与极值着色 */
  resultTypes: DictItemOption[];
}) {
  const gapStyle = { marginLeft: STATS_GAP_PX };

  const extreme = (
    hasExtreme: boolean,
    extremeCode: string,
    value: number | null,
    resultType: string | null,
  ) => {
    const dict = resultTypes.find((option) => option.code === extremeCode);
    if (hasExtreme) {
      // 字典未加载时回退 code 原文（同 ReportCell 口径），不硬编码 'High'/'Low' 文案
      return <span style={{ color: dict?.color ?? undefined }}>{dict?.label ?? extremeCode}</span>;
    }
    if (value !== null) {
      const valueDict = resultTypes.find((option) => option.code === resultType);
      return (
        <span className="gc-num">
          <span style={{ color: valueDict?.color ?? undefined }}>{value.toFixed(1)}</span>
          {' mmol/L'}
        </span>
      );
    }
    return <span>-</span>;
  };

  return (
    <Typography.Text type="secondary">
      总计：<span className="gc-num">{stats.total}</span> 次
      <span style={gapStyle}>|</span>
      <span style={gapStyle}>
        合格次数：<span className="gc-num">{stats.qualified}</span> 次
      </span>
      <span style={gapStyle}>
        最高血糖：
        {extreme(stats.hasHigh, GLUCOSE_RESULT_CODE_HIGH, stats.maxValueMmolL, stats.maxResultType)}
      </span>
      <span style={gapStyle}>
        最低血糖：
        {extreme(stats.hasLow, GLUCOSE_RESULT_CODE_LOW, stats.minValueMmolL, stats.minResultType)}
      </span>
    </Typography.Text>
  );
}

/**
 * 血糖报告（路由 `/inpatient/patients/:id/glucose/report`）。
 *
 * 表头由**服务端下发的 `columns`** 生成，不读 `useCommonDataStore().timeSlots`：
 * 归组在服务端做，表头也必须与之同源，否则会出现"记录归到了某列、但前端没画这一列"的数据丢失。
 * R22：`columns` 只含**启用的**时段；弃用时段的历史血糖由服务端按检测时间合并进启用列，
 * 记录带 `sourceSlotName` 后缀与 `sourceType` 原类型，前端据展示勾选过滤（filterReportRows）。
 */
export default function GlucoseReportTab() {
  const { id } = useParams<{ id: string }>();
  const { glucoseVersion, reportDisplay } = useOutletContext<DetailChildContext>();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  // R23：全屏态（表格撑满视口）。纯视图状态，不持久化、不影响请求与分页
  const [fullscreen, setFullscreen] = useState(false);
  // R24：查询表单态（null = 住院记录未就绪）与**已应用**的查询范围分离——
  // 改表单不触发请求，点「查询」/初始默认态/重置才更新 appliedRange（裁定 Q15/Q16）
  const admissions = useAdmissions(id);
  const [queryForm, setQueryForm] = useState<ReportQueryFormState | null>(null);
  const [appliedRange, setAppliedRange] = useState<GlucoseReportRange>({});
  const { data, loading, error, reload } = useGlucoseReport(
    id,
    page,
    glucoseVersion,
    appliedRange,
    queryForm !== null,
  );
  // 字典只在这里订阅一次，再传给每个单元格（见 ReportCell 注释）
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );

  // 换患者时回到第 1 页、退出全屏并重置查询表单：同一路由不同 :id 不会重挂载组件，
  // state 需手动重置。表单置回 null（未就绪）→ 报表请求挂起，等新患者的住院记录到达
  useEffect(() => {
    setPage(1);
    setFullscreen(false);
    setQueryForm(null);
    setAppliedRange({});
  }, [id]);

  // R24：住院记录就绪 → 初始化默认表单态并自动按默认条件查询（裁定 Q15）；
  // 请求失败 → 退化为「全部 + 无限制」可用态（规格 §6，不阻塞报表本体）
  useEffect(() => {
    if (queryForm !== null) {
      return;
    }
    if (admissions.data) {
      const defaults = deriveQueryDefaults(admissions.data);
      setQueryForm(defaults);
      setAppliedRange(toReportRange(defaults));
    } else if (admissions.error) {
      setQueryForm({ ...FALLBACK_FORM_STATE });
      setAppliedRange({});
    }
  }, [admissions.data, admissions.error, queryForm]);

  // R24：查询——校验开始≤结束（裁定 Q13）后应用范围并回到第 1 页（裁定 Q16）
  const handleSearch = () => {
    if (!queryForm) {
      return;
    }
    if (isRangeInverted(queryForm)) {
      void message.warning('开始时间不能晚于结束时间');
      return;
    }
    setAppliedRange(toReportRange(queryForm));
    setPage(1);
  };

  // R24：重置 = 恢复进入页面时的默认态并自动查询（裁定 Q17 + §11-2），不是清空
  const handleReset = () => {
    if (!admissions.data) {
      return;
    }
    const defaults = deriveQueryDefaults(admissions.data);
    setQueryForm(defaults);
    setAppliedRange(toReportRange(defaults));
    setPage(1);
  };

  // R23：ESC 退出全屏（通用全屏交互；仅全屏态挂监听，退出即卸载）
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  // R22 规则 4：勾选变化实时过滤已下发数据，不重新请求（裁定 Q5）
  const rows = useMemo(
    () => filterReportRows(data?.rows ?? [], reportDisplay),
    [data?.rows, reportDisplay],
  );

  const columns = useMemo<ColumnsType<GlucoseReportRow>>(() => {
    const dateColumn: ColumnsType<GlucoseReportRow>[number] = {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      align: 'center',
      width: DATE_COLUMN_WIDTH,
      // span 是行内元素，居中由列的 align: 'center'（td text-align）驱动，无需 inline 覆盖
      render: (date: string) => <span className="gc-num">{date}</span>,
    };

    const slotColumns: ColumnsType<GlucoseReportRow> = (data?.columns ?? []).map((column) => ({
      // 表头文字取库里的 TimeSlot.name，禁止硬编码、禁止按名称匹配（code 才是契约）
      title: column.name,
      key: column.code,
      align: 'center',
      render: (_: unknown, row: GlucoseReportRow) => (
        <ReportCell
          cell={row.cells.find((cell) => cell.slotCode === column.code)}
          resultTypes={resultTypes}
          display={reportDisplay}
        />
      ),
    }));

    return [dateColumn, ...slotColumns];
  }, [data?.columns, resultTypes, reportDisplay]);

  // R21（2026-11-19 裁定）：根节点撑满内容区高度，统计栏固定、表格占据剩余空间、
  // 只在表格 body 内滚动。overflow auto 仅作极矮视口兜底（表格区压到最小高度后
  // 整页在根节点内滚动），正常视口下内容恰好占满、不出现滚动条。
  // R23 全屏态：fixed 覆盖整个视口（不用浏览器 Fullscreen API——antd 弹层挂 body，
  // 该模式下会不可见，且纯 CSS 方案无兼容性问题）；flex 链与 .gc-report-table 不变，
  // 表格随之撑满视口、body 内滚、分页钉底。zIndex 取 token 不写魔法数字，
  // 低于 message（zIndexPopupBase 之上还有弹层增量），全屏中操作反馈不被遮挡
  const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    overflow: 'auto',
    ...(fullscreen
      ? {
          position: 'fixed',
          inset: 0,
          zIndex: token.zIndexPopupBase,
          background: token.colorBgContainer,
          padding: token.padding,
        }
      : null),
  };

  return (
    <div style={rootStyle}>
      {/* R20 预留位兑现（R24，裁定 Q18a）：统计栏居左 + 查询表单 + 全屏按钮最右
          （marginLeft auto）；窄屏接受换行（flexWrap）。全屏态该行随统计栏固定在
          视口顶部、表单照常可用（R23 的 fixed 覆盖层包住整棵子树，无需额外处理） */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: token.margin,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {data ? <ReportStatsBar stats={data.stats} resultTypes={resultTypes} /> : null}
        <ReportQueryForm
          data={admissions.data}
          loading={admissions.loading}
          state={queryForm}
          onChange={setQueryForm}
          onSearch={handleSearch}
          onReset={handleReset}
        />
        <FullscreenToggle fullscreen={fullscreen} onToggle={setFullscreen} />
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ flexShrink: 0 }}
          action={
            <Button size="small" danger onClick={reload}>
              重试
            </Button>
          }
        />
      ) : null}

      <Table<GlucoseReportRow>
        rowKey="date"
        size="small"
        bordered
        columns={columns}
        dataSource={rows}
        loading={loading}
        // R21：flex 链与 body 内滚由 global.css 的 .gc-report-table 承接（antd 无百分比
        // 撑满 API，scroll.y 传 '100%' 只为触发表头/body 拆分，实际高度由 flex 决定）
        className="gc-report-table"
        style={{ minHeight: REPORT_TABLE_MIN_HEIGHT }}
        scroll={{ y: '100%' }}
        // 2026-11-19 二次调整：不横向滚动、日期列不固定——11 列均分页面宽度全部可见
        // （不设 scroll.x；单元格内容允许换行，见 ReportCell 注释）
        pagination={{
          current: page,
          pageSize: GLUCOSE_REPORT_PAGE_SIZE,
          // total 是**日期总数**而非记录条数，故文案用"天"
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 天`,
        }}
      />
    </div>
  );
}
