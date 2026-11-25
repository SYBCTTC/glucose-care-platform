import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Alert, Button, Table, message, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useOutletContext, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  DICT_TYPE,
  GLUCOSE_REPORT_PAGE_SIZE,
  PATIENT_STATUS,
  PERMISSION,
  TIME_SLOT_CATEGORY,
} from '@gc/shared';
import type {
  DictItemOption,
  GlucoseReportCell,
  GlucoseReportEntry,
  GlucoseReportRow,
} from '@gc/shared';
import {
  FALLBACK_FORM_STATE,
  GlucoseQueryForm,
  deriveQueryDefaults,
  isRangeInverted,
  toQueryRange,
} from '@/components/glucose/GlucoseQueryForm';
import type { GlucoseQueryFormState } from '@/components/glucose/GlucoseQueryForm';
import { GlucoseToolbar } from '@/components/glucose/GlucoseToolbar';
import GlucosePrintModal from '@/components/glucose/print/GlucosePrintModal';
import { useFullscreen } from '@/components/glucose/useFullscreen';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import GlucoseCreateModal from '../patients/GlucoseCreateModal';
import type { DetailChildContext, GlucoseReportDisplay } from './detail-tabs';
import GlucoseReviewModal from './GlucoseReviewModal';
import { buildReportStatsItems } from './buildReportStatsItems';
import { useGlucoseReport } from './useGlucoseReport';
import type { GlucoseReportRange } from './useGlucoseReport';
import { useAdmissions } from './useAdmissions';

/** 日期列宽提示：容纳 `YYYY-MM-DD` 等宽数字；时段列不定宽，均分剩余空间（2026-11-19 二次调整：不横向滚动） */
const DATE_COLUMN_WIDTH = 116;
/** 值行内间距：需求人明确指定 6px（2026-11-19 三次调整），非 token 档位故立常量注明出处 */
const VALUE_GAP_PX = 6;
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
 * R25：空白格可点击填充块的最小高度（px）。
 * 与两条记录（两行文本 + 行距）的高度大体一致，避免「可点/不可点」两种状态行高跳动。
 * 非 token 档位（视觉对齐值），立常量注明出处。
 */
const EMPTY_CELL_MIN_HEIGHT = 44;

/**
 * R25：可点击块的公共交互壳（entry 块 / 空白格共用）。
 * hover 反馈 + 键盘可达（Enter/Space，ui-design-tokens 规则 5）；
 * 独立小组件让 hover state 只重渲染自身，不波及整表；
 * hover 背景是内联状态，打印媒体不会触发，无需 gc-no-print。
 */
function ClickableCellArea({
  onClick,
  ariaLabel,
  minHeight,
  children,
}: {
  onClick: () => void;
  ariaLabel?: string;
  minHeight?: number;
  children?: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const { token } = theme.useToken();
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        borderRadius: token.borderRadiusSM,
        background: hover ? token.colorFillTertiary : undefined,
        minHeight,
      }}
    >
      {children}
    </div>
  );
}

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
  onEntryClick,
  onEmptyClick,
}: {
  cell: GlucoseReportCell | undefined;
  /** DY-RESULT 字典项，用于取标签与色值 */
  resultTypes: DictItemOption[];
  /** R22 展示项勾选（常规/强化的记录显隐由 filterReportRows 在行级处理，这里只管时间/操作人） */
  display: GlucoseReportDisplay;
  /**
   * R25：点击 entry 块（两行整体）→ review 弹框；不传 = 非交互（静态渲染/打印）。
   * 有 `patient:view` 即可点开只读 review（裁定 Q9），编辑/删除按钮在弹框内按权限显隐。
   */
  onEntryClick?: (entryId: string) => void;
  /**
   * R25：点击空白格 → 添加弹框（预填该行日期 + 该列时段）；不传 = 不可点。
   * 裁定 Q14/Q16：以**可见** entries 为准——被展示勾选隐藏后视觉为空的格子同样按空白格处理；
   * 可点性由父层按 `glucose:create` + 住院中门控（前端显隐只是体验，服务端才是边界）。
   */
  onEmptyClick?: () => void;
}) {
  const { token } = theme.useToken();

  // 2026-11-19 二次调整：无数据的格子渲染为空，不放 `-` 占位
  // R25：有添加入口时空白格渲染为可点击填充块
  if (!cell?.entries.length) {
    return onEmptyClick ? (
      <ClickableCellArea
        onClick={onEmptyClick}
        ariaLabel="添加血糖"
        minHeight={EMPTY_CELL_MIN_HEIGHT}
      />
    ) : null;
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
          entry.valueMmolL === null
            ? (dict?.label ?? entry.resultType)
            : entry.valueMmolL.toFixed(1);
        // 规则 6：特殊时段来源（含弃用的特殊时段、归组失败兜底）时间恒展示，不受「检测时间」勾选控制
        const showTime = display.time || entry.sourceType === TIME_SLOT_CATEGORY.SPECIAL;

        // R25：两行内容整体作为点击目标（第 1 行 值+时间+来源时段名 / 第 2 行 记录者）
        const content = (
          <>
            {/* gc-num 提供等宽数字；其默认右对齐被 flex 居中覆盖（2026-11-19 二次调整：格内居中）。
                间距（2026-11-19 三次调整，需求人指定 6px）：`值` 与 `(时间)` 之间恒有间距；
                有来源时段名时 `(时间)` 与 `(名称)` 之间同样加间距。
                2026-11-25 变更：margin 改 flex columnGap——margin 在段换行后变成行首缩进，
                导致「(时间) 独占一行时不居中」；gap 只作用于同行相邻项，wrap+justifyContent
                保证每行真居中。值与时间段加 nowrap：`(06:30)` 成为不可拆整体（要么同排要么
                整段换行），杜绝 td 的 overflow-wrap:break-word 把段内断出孤儿 `)`；
                来源时段名段不加 nowrap（如 `(强化-下午)` ≈72px > 打印列内容宽 ≈56px，
                加了会撑破格子），保留自然换行。 */}
            <div
              className="gc-num"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                columnGap: VALUE_GAP_PX,
              }}
            >
              <span style={{ color: dict?.color ?? undefined, whiteSpace: 'nowrap' }}>{text}</span>
              {showTime ? <span style={{ whiteSpace: 'nowrap' }}>({entry.time})</span> : null}
              {entry.sourceSlotName ? <span>({entry.sourceSlotName})</span> : null}
            </div>
            {display.operator ? (
              <div style={{ color: token.colorTextSecondary }}>{entry.nurseName ?? '-'}</div>
            ) : null}
          </>
        );

        return (
          <div key={entry.id} style={index > 0 ? separatorStyle : undefined}>
            {onEntryClick ? (
              <ClickableCellArea onClick={() => onEntryClick(entry.id)}>
                {content}
              </ClickableCellArea>
            ) : (
              content
            )}
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
 * R25（裁定 Q15）：空白格点击添加的预填值。
 *
 * `measuredAt` = **该行日期 + 当前时刻的时分秒**（历史日期照此拼接，需求人明确裁定）；
 * `mealContext` = 该列时段 code。预填时段在添加弹框里视为「已手动选择」，
 * 不被按检测时间自动推荐覆盖（裁定 Q16 口径），用户仍可改。
 * 导出仅为单测（同 ReportCell 的理由）。
 */
export function buildAddPrefill(
  date: string,
  mealContext: string,
  now: Dayjs,
): { measuredAt: Dayjs; mealContext: string } {
  return {
    measuredAt: dayjs(`${date} ${now.format('HH:mm:ss')}`, 'YYYY-MM-DD HH:mm:ss'),
    mealContext,
  };
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
  const { glucoseVersion, reportDisplay, onGlucoseChanged, patient, patientDetail } =
    useOutletContext<DetailChildContext>();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  // R23：全屏态（表格撑满视口）收拢进公共 hook——状态、ESC 退出、fixed 覆盖样式、
  // 换患者重置原本分散在本组件四处，三页复用后由 useFullscreen 统一保证行为一致
  const { fullscreen, toggle, exit: exitFullscreen, overlayStyle } = useFullscreen();
  // R24：查询表单态（null = 住院记录未就绪）与**已应用**的查询范围分离——
  // 改表单不触发请求，点「查询」/初始默认态/重置才更新 appliedRange（裁定 Q15/Q16）
  const admissions = useAdmissions(id);
  const [queryForm, setQueryForm] = useState<GlucoseQueryFormState | null>(null);
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

  // R25：表格内两个弹框的状态——点击 entry 块 → review/编辑；点击空白格 → 添加（预填）
  const [reviewRecordId, setReviewRecordId] = useState<string | null>(null);
  const [addPrefill, setAddPrefill] = useState<{ measuredAt: Dayjs; mealContext: string } | null>(
    null,
  );
  const hasPermission = useAuthStore((state) => state.hasPermission);
  // 空白格添加入口与壳上「添加血糖」按钮同口径：住院中 + glucose:create（裁定 Q14；
  // 前端显隐只是体验，服务端才是边界）。entry 点击不设权限门槛：有 patient:view 即可只读 review（裁定 Q9）
  const canAdd =
    patient.status === PATIENT_STATUS.INPATIENT && hasPermission(PERMISSION.GLUCOSE_CREATE);
  const handleEntryClick = useCallback((entryId: string) => {
    setReviewRecordId(entryId);
  }, []);
  const handleEmptyClick = useCallback((date: string, slotCode: string) => {
    setAddPrefill(buildAddPrefill(date, slotCode, dayjs()));
  }, []);

  // R28：打印门控（裁定 Q5/Q6/B3）——无 glucose:print 不传 onPrint（按钮不渲染，
  // 服务端接口兜底）；已应用范围内无日期（total=0）禁用。预览数据在 Modal 打开时
  // 按范围全量拉取（裁定 B1），打印跟随展示勾选 reportDisplay（规格 §4 规则 6）
  const canPrint = hasPermission(PERMISSION.GLUCOSE_PRINT);
  const [printOpen, setPrintOpen] = useState(false);

  // 换患者时回到第 1 页、退出全屏并重置查询表单：同一路由不同 :id 不会重挂载组件，
  // state 需手动重置。表单置回 null（未就绪）→ 报表请求挂起，等新患者的住院记录到达
  useEffect(() => {
    setPage(1);
    exitFullscreen();
    setQueryForm(null);
    setAppliedRange({});
  }, [id, exitFullscreen]);

  // R24：住院记录就绪 → 初始化默认表单态并自动按默认条件查询（裁定 Q15）；
  // 请求失败 → 退化为「全部 + 无限制」可用态（规格 §6，不阻塞报表本体）
  useEffect(() => {
    if (queryForm !== null) {
      return;
    }
    if (admissions.data) {
      const defaults = deriveQueryDefaults(admissions.data);
      setQueryForm(defaults);
      setAppliedRange(toQueryRange(defaults));
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
    setAppliedRange(toQueryRange(queryForm));
    setPage(1);
  };

  // R24：重置 = 恢复进入页面时的默认态并自动查询（裁定 Q17 + §11-2），不是清空
  const handleReset = () => {
    if (!admissions.data) {
      return;
    }
    const defaults = deriveQueryDefaults(admissions.data);
    setQueryForm(defaults);
    setAppliedRange(toQueryRange(defaults));
    setPage(1);
  };

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
          // R25：entry 块 → review 弹框；空白格 → 添加弹框（预填该行日期 + 该列时段）
          onEntryClick={handleEntryClick}
          onEmptyClick={canAdd ? () => handleEmptyClick(row.date, column.code) : undefined}
        />
      ),
    }));

    return [dateColumn, ...slotColumns];
  }, [data?.columns, resultTypes, reportDisplay, handleEntryClick, handleEmptyClick, canAdd]);

  // 统计项：把报表 stats 适配成公共统计栏的 items（R20 口径，见 buildReportStatsItems）。
  // useMemo 保持引用稳定——data/resultTypes 未变时不产生新数组，避免工具栏无谓重渲染
  const statsItems = useMemo(
    () => (data ? buildReportStatsItems(data.stats, resultTypes) : undefined),
    [data, resultTypes],
  );

  // R21（2026-11-19 裁定）：根节点撑满内容区高度，统计栏固定、表格占据剩余空间、
  // 只在表格 body 内滚动。overflow auto 仅作极矮视口兜底（表格区压到最小高度后
  // 整页在根节点内滚动），正常视口下内容恰好占满、不出现滚动条。
  // R23 全屏态：叠加 useFullscreen 产出的 fixed 覆盖样式（不用浏览器 Fullscreen API——
  // antd 弹层挂 body，该模式下会不可见，且纯 CSS 方案无兼容性问题）；flex 链与
  // .gc-report-table 不变，表格随之撑满视口、body 内滚、分页钉底
  const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    overflow: 'auto',
    ...overlayStyle,
  };

  return (
    <div style={rootStyle}>
      {/* R20 预留位兑现（R24，裁定 Q18a）：统计栏居左 + 查询表单 + 全屏按钮最右。
          这一行的布局（space-between / flexWrap / flexShrink:0）与打印隐藏口径由公共
          GlucoseToolbar 承接，记录页与趋势图复用同一行；全屏态它随覆盖层固定在视口
          顶部、表单照常可用。统计项经 buildReportStatsItems 把报表 stats 适配成公共
          items（R20 口径不变），data 未到时不传 → 统计区不渲染、按钮仍靠右 */}
      <GlucoseToolbar
        stats={statsItems}
        form={
          <GlucoseQueryForm
            data={admissions.data}
            loading={admissions.loading}
            state={queryForm}
            onChange={setQueryForm}
            onSearch={handleSearch}
            onReset={handleReset}
            onPrint={canPrint ? () => setPrintOpen(true) : undefined}
            printDisabled={!data || data.total === 0}
          />
        }
        fullscreen={fullscreen}
        onToggleFullscreen={toggle}
      />

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

      {/* R25：报表子路由内挂载的弹框（壳上那个服务列表/详情入口，这两个服务表格单元格入口）。
          成功统一走 onGlucoseChanged（壳层 glucoseVersion+1 → 本报表自动重拉），
          R24 查询条件 / R22 勾选 / R23 全屏态均不受影响 */}
      <GlucoseCreateModal
        patient={patient}
        open={addPrefill !== null}
        prefill={addPrefill}
        onClose={() => setAddPrefill(null)}
        onSuccess={onGlucoseChanged}
      />
      <GlucoseReviewModal
        patient={patient}
        recordId={reviewRecordId}
        onClose={() => setReviewRecordId(null)}
        onChanged={onGlucoseChanged}
      />

      {/* R28：打印预览（三 Tab 共用 Modal）——打开时拉明文姓名（访问即留痕）与
          范围内全量报表；点「打印」先留痕（GLUCOSE_PRINT）再触发浏览器打印（裁定 Q11） */}
      {canPrint ? (
        <GlucosePrintModal
          open={printOpen}
          onClose={() => setPrintOpen(false)}
          printType="report"
          patient={patientDetail}
          range={appliedRange}
          reportDisplay={reportDisplay}
        />
      ) : null}
    </div>
  );
}
