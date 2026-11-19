import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Table, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useOutletContext, useParams } from 'react-router-dom';
import {
  DICT_TYPE,
  GLUCOSE_REPORT_PAGE_SIZE,
  GLUCOSE_RESULT_CODE_HIGH,
  GLUCOSE_RESULT_CODE_LOW,
} from '@gc/shared';
import type {
  DictItemOption,
  GlucoseReportCell,
  GlucoseReportEntry,
  GlucoseReportRow,
  GlucoseReportStats,
} from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';
import type { DetailOutletContext } from './detail-tabs';
import { useGlucoseReport } from './useGlucoseReport';

/** 日期列宽提示：容纳 `YYYY-MM-DD` 等宽数字；时段列不定宽，均分剩余空间（2026-11-19 二次调整：不横向滚动） */
const DATE_COLUMN_WIDTH = 116;
/** 值行内间距：需求人明确指定 6px（2026-11-19 三次调整），非 token 档位故立常量注明出处 */
const VALUE_GAP_PX = 6;
/** 统计栏段落间距：需求人明确指定 20px（R20），非 token 档位故立常量注明出处 */
const STATS_GAP_PX = 20;

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
 *  - 第 1 行 `{值或标签}({HH:mm})`，强化时段再追加 `({强化时段名})`；
 *  - 第 2 行 记录者姓名。
 * 同日同时段多条 → 纵向堆叠，组间加分隔线（R4）。
 *
 * 括号一律**英文半角、紧邻无空格**；着色只作用于「值/标签」部分，
 * 时间与强化名用正文色（D4）——整行染色会让时间也带上告警色，读起来像异常值。
 */
/**
 * 导出仅为单测（`GlucoseReportTab.spec.tsx`）：单元格的渲染口径是 R3/R4 的验收主体，
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
}: {
  cell: GlucoseReportCell | undefined;
  /** DY-RESULT 字典项，用于取标签与色值 */
  resultTypes: DictItemOption[];
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

        return (
          <div key={`${entry.time}-${index}`} style={index > 0 ? separatorStyle : undefined}>
            {/* gc-num 提供等宽数字；其默认右对齐被 inline center 覆盖（2026-11-19 二次调整：格内居中）。
                不设 nowrap：列宽均分页面时允许括号段换行，保证表格不横向滚动。
                间距（2026-11-19 三次调整，需求人指定 6px）：`值` 与 `(时间)` 之间恒有间距；
                有强化时段时 `(时间)` 与 `(强化名)` 之间同样加间距。
                用 margin 而非空格字符：文本口径仍是「紧邻无空格」（R3），且 inline margin 不破坏居中 */}
            <div className="gc-num" style={{ textAlign: 'center' }}>
              <span style={{ color: dict?.color ?? undefined }}>{text}</span>
              <span style={{ marginLeft: VALUE_GAP_PX }}>({entry.time})</span>
              {entry.intensiveName ? (
                <span style={{ marginLeft: VALUE_GAP_PX }}>({entry.intensiveName})</span>
              ) : null}
            </div>
            <div style={{ color: token.colorTextSecondary }}>{entry.nurseName ?? '-'}</div>
          </div>
        );
      })}
    </div>
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
 * `columns` 含停用时段，因为停用前的历史血糖必须有列可落。
 */
export default function GlucoseReportTab() {
  const { id } = useParams<{ id: string }>();
  const { glucoseVersion } = useOutletContext<DetailOutletContext>();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useGlucoseReport(id, page, glucoseVersion);
  // 字典只在这里订阅一次，再传给每个单元格（见 ReportCell 注释）
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );

  // 换患者时回到第 1 页：同一路由不同 :id 不会重挂载组件，state 需手动重置
  useEffect(() => {
    setPage(1);
  }, [id]);

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
        />
      ),
    }));

    return [dateColumn, ...slotColumns];
  }, [data?.columns, resultTypes]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS }}>
      {/* R20 布局预留：统计栏居左；下一个任务的查询筛选表单挂同一行右侧（左右分布），
          本轮不实现表单——space-between 下单个子元素天然左对齐，无需占位节点 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: token.margin,
          flexWrap: 'wrap',
        }}
      >
        {data ? <ReportStatsBar stats={data.stats} resultTypes={resultTypes} /> : null}
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
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
        dataSource={data?.rows ?? []}
        loading={loading}
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
