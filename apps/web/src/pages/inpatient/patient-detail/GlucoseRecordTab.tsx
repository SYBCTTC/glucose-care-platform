import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Alert, Button, Table, Tooltip, message, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useOutletContext, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { DICT_TYPE, GLUCOSE_RECORD_PAGE_SIZE, PERMISSION, isGlucoseValueResult } from '@gc/shared';
import type { DictItemOption, GlucoseRecordListItem, TimeSlotOption } from '@gc/shared';
import {
  FALLBACK_FORM_STATE,
  GlucoseQueryForm,
  deriveQueryDefaults,
  isRangeInverted,
  toQueryRange,
} from '@/components/glucose/GlucoseQueryForm';
import type { GlucoseQueryFormState } from '@/components/glucose/GlucoseQueryForm';
import { GlucoseToolbar } from '@/components/glucose/GlucoseToolbar';
import GlucosePrintRunner from '@/components/glucose/print/GlucosePrintRunner';
import { useFullscreen } from '@/components/glucose/useFullscreen';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import type { DetailChildContext } from './detail-tabs';
import GlucoseReviewModal from './GlucoseReviewModal';
import { buildReportStatsItems } from './buildReportStatsItems';
import { useGlucoseRecords } from './useGlucoseRecords';
import type { GlucoseRecordRange } from './useGlucoseRecords';
import { useAdmissions } from './useAdmissions';

/**
 * R27：血糖记录列表（路由 `/inpatient/patients/:id/glucose/record`）。
 * 规格 docs/specs/glucose-record.md（2026-11-23 需求人 8 项裁定 Q1~Q8）。
 *
 * 复用面（零改动）：R24 表单联动状态机（GlucoseQueryForm + useAdmissions + 默认态推导）、
 * R26 公共件（GlucoseToolbar 统计栏/全屏）、R25 复核弹窗（点血糖值 → review → edit）、
 * 报表统计口径（buildReportStatsItems，裁定 Q8：同范围与报表 Tab 同数字）。
 * 本页特有：5 列平铺表格 + 按记录条数分页（固定 15 条/页，无条数切换器）。
 * 明确不做：添加入口（壳顶部「添加血糖」是既有能力）、展示勾选（R22 规则 2 属报表专属）、
 * 「含作废」开关（裁定 Q2：作废记录任何读路径不可见）。
 */

/** 检测时间展示格式（规则 2）：分钟级。查询/排序仍用秒级全量，仅展示截断 */
const RECORD_TIME_FORMAT = 'YYYY-MM-DD HH:mm';

/** 表格区最小高度：同报表（R21 口径），极矮视口下的防塌缩兜底 */
const RECORD_TABLE_MIN_HEIGHT = 200;

/**
 * 字典缺失时的稳定空值。必须是**模块级常量**：
 * 若在 selector 里写 `?? []`，每次调用都产生新数组，zustand 用 `Object.is` 比较会判定
 * "状态变了" → 无限重渲染（同 GlucoseReportTab 的 EMPTY_RESULT_TYPES）。
 */
const EMPTY_RESULT_TYPES: DictItemOption[] = [];

/** 检测时间：契约串（YYYY-MM-DD HH:mm:ss 本地时刻）截到分钟；空/非法值防御性回退。导出供单测与 R28 打印复用 */
export function formatRecordTime(measuredAt: string): string {
  if (!measuredAt) {
    return '-';
  }
  const parsed = dayjs(measuredAt);
  return parsed.isValid() ? parsed.format(RECORD_TIME_FORMAT) : measuredAt;
}

/**
 * 检测时段：code → 动态时段名（含停用项回显），查不到回退 code，null → '-'。
 * 与复核弹窗 buildReviewFields 同一约定；**禁止按名称匹配**（code 才是契约）。导出供单测与 R28 打印复用。
 */
export function formatMealContext(code: string | null, timeSlots: TimeSlotOption[]): string {
  if (!code) {
    return '-';
  }
  return timeSlots.find((slot) => slot.code === code)?.name ?? code;
}

/**
 * 血糖值单元格文案与颜色（裁定 Q3：与报表格/复核弹窗同一渲染约定，色+文双通道）：
 *  - 数值型(0/1/2)：一位小数数值（valueMmolL 防御性为 null 时 '-'）；
 *  - 非数值型(3~9)：字典标签（Low/High/拒检/外出…），字典查不到回退 code；
 *  - 颜色一律取结果类型字典色。
 * 导出供单测与 R28 打印复用（裁定 Q1：打印同样保留色+文双通道）。
 */
export function buildRecordValue(
  item: Pick<GlucoseRecordListItem, 'resultType' | 'valueMmolL'>,
  resultTypes: DictItemOption[],
): { text: string; color?: string } {
  const dict = resultTypes.find((option) => option.code === item.resultType);
  const text = isGlucoseValueResult(item.resultType)
    ? item.valueMmolL === null
      ? '-'
      : item.valueMmolL.toFixed(1)
    : (dict?.label ?? item.resultType);
  return { text, color: dict?.color ?? undefined };
}

/**
 * 血糖值单元格：整格可点击（规则 4，**含非数值行**——拒检/外出同样有记录详情）→
 * R25 复核弹窗（review → 编辑）。交互壳同报表格 ClickableCellArea：hover 反馈 +
 * 键盘可达（Enter/Space，ui-design-tokens 规则 5）；独立小组件让 hover 只重渲染自身。
 * 导出仅为单测。
 */
export function RecordValueCell({
  item,
  resultTypes,
  onClick,
}: {
  item: GlucoseRecordListItem;
  resultTypes: DictItemOption[];
  onClick: (recordId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const { token } = theme.useToken();
  const { text, color } = buildRecordValue(item, resultTypes);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`血糖值 ${text}，点击查看详情`}
      onClick={() => onClick(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick(item.id);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        borderRadius: token.borderRadiusSM,
        background: hover ? token.colorFillTertiary : undefined,
        // 色+文双通道（裁定 Q3）：颜色只是冗余通道，文案自身已可区分
        color: color ?? token.colorText,
      }}
    >
      <span className="gc-num">{text}</span>
    </div>
  );
}

export default function GlucoseRecordTab() {
  const { id } = useParams<{ id: string }>();
  const { glucoseVersion, onGlucoseChanged, patient, patientDetail } =
    useOutletContext<DetailChildContext>();
  const { token } = theme.useToken();
  const [page, setPage] = useState(1);
  // R23/R26：全屏态走公共 hook（ESC 退出、换患者重置、fixed 覆盖样式）
  const { fullscreen, toggle, exit: exitFullscreen, overlayStyle } = useFullscreen();
  // R24 状态机：表单态与**已应用**范围分离——改表单不触发请求，点「查询」/初始默认态/重置才应用
  const admissions = useAdmissions(id);
  const [queryForm, setQueryForm] = useState<GlucoseQueryFormState | null>(null);
  const [appliedRange, setAppliedRange] = useState<GlucoseRecordRange>({});
  const { data, loading, error, reload } = useGlucoseRecords(
    id,
    page,
    glucoseVersion,
    appliedRange,
    queryForm !== null,
  );
  // 字典/时段只在这里订阅一次再传下去（同 ReportCell 注释：避免逐格订阅）
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );
  const timeSlots = useCommonDataStore((state) => state.timeSlots);

  // R25 复核弹窗（点血糖值打开）：编辑/作废成功走 onGlucoseChanged → 版本号 +1 → 列表+统计重拉
  const [reviewRecordId, setReviewRecordId] = useState<string | null>(null);
  const handleValueClick = useCallback((recordId: string) => {
    setReviewRecordId(recordId);
  }, []);

  // R28：打印门控（裁定 Q5/Q6/B3）——无 glucose:print 不传 onPrint（按钮不渲染，
  // 服务端接口兜底）；已应用范围内无记录（total=0）禁用。无头执行器挂载时
  // 按范围全量拉取（裁定 B1/Q12：循环拉页不设上限），列与屏幕一致（规格 §4 规则 7）
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canPrint = hasPermission(PERMISSION.GLUCOSE_PRINT);
  const [printRunning, setPrintRunning] = useState(false);

  // 换患者时回到第 1 页、退出全屏并重置查询表单：同一路由不同 :id 不会重挂载组件，
  // state 需手动重置。表单置回 null（未就绪）→ 列表请求挂起，等新患者的住院记录到达
  useEffect(() => {
    setPage(1);
    exitFullscreen();
    setQueryForm(null);
    setAppliedRange({});
  }, [id, exitFullscreen]);

  // R24（裁定 Q15）：住院记录就绪 → 初始化默认表单态并自动按默认条件查询；
  // 请求失败 → 退化为「全部 + 无限制」可用态，不阻塞列表本体
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

  // R24：重置 = 恢复进入页面时的默认态并自动查询（裁定 Q17），不是清空
  const handleReset = () => {
    if (!admissions.data) {
      return;
    }
    const defaults = deriveQueryDefaults(admissions.data);
    setQueryForm(defaults);
    setAppliedRange(toQueryRange(defaults));
    setPage(1);
  };

  // 5 列固定列序（规则 2）：检测时间｜检测时段｜血糖值｜检测人｜备注；空值一律 '-'
  const columns = useMemo<ColumnsType<GlucoseRecordListItem>>(
    () => [
      {
        title: '检测时间',
        dataIndex: 'measuredAt',
        key: 'measuredAt',
        width: 170,
        render: (measuredAt: string) => (
          <span className="gc-num">{formatRecordTime(measuredAt)}</span>
        ),
      },
      {
        title: '检测时段',
        dataIndex: 'mealContext',
        key: 'mealContext',
        width: 140,
        render: (code: string | null) => formatMealContext(code, timeSlots),
      },
      {
        title: '血糖值',
        dataIndex: 'valueMmolL',
        key: 'valueMmolL',
        width: 120,
        render: (_: unknown, record) => (
          <RecordValueCell item={record} resultTypes={resultTypes} onClick={handleValueClick} />
        ),
      },
      {
        title: '检测人',
        dataIndex: 'operatorName',
        key: 'operatorName',
        width: 140,
        render: (name: string | null) => name ?? '-',
      },
      {
        title: '备注',
        dataIndex: 'remark',
        key: 'remark',
        // 超长省略 + Tooltip（antd 原生 title 换成 Tooltip 组件，明暗主题跟随）
        ellipsis: { showTitle: false },
        render: (remark: string | null) =>
          remark ? (
            <Tooltip title={remark} placement="topLeft">
              {remark}
            </Tooltip>
          ) : (
            '-'
          ),
      },
    ],
    [timeSlots, resultTypes, handleValueClick],
  );

  // 统计栏：与报表同一构建函数（裁定 Q8：同范围下与报表 Tab 数字完全一致）。
  // data 未到时不传 → 统计区不渲染、全屏按钮仍靠右（GlucoseToolbar 既有行为）
  const statsItems = useMemo(
    () => (data ? buildReportStatsItems(data.stats, resultTypes) : undefined),
    [data, resultTypes],
  );

  // 根节点布局同报表（R21/R23 口径）：撑满内容区、工具栏固定、表格占剩余空间 body 内滚；
  // 全屏态叠加 useFullscreen 的 fixed 覆盖样式。
  // gap 16px（2026-11-26 样式调整）：公共工具栏块与内容区（表格）的间距与块内部间距一致
  const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: token.margin,
    overflow: 'auto',
    ...overlayStyle,
  };

  return (
    <div style={rootStyle}>
      {/* R26 公共工具栏（2026-11-26 起两行：统计栏一行 + 表单/全屏一行）。
          裁定 Q4：extra 插槽不使用——记录页无追加筛选；展示勾选属报表专属，本页不渲染 */}
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
            onPrint={canPrint ? () => setPrintRunning(true) : undefined}
            printDisabled={!data || data.total === 0}
            printLoading={printRunning}
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

      <Table<GlucoseRecordListItem>
        rowKey="id"
        size="small"
        bordered
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        // gc-report-table 是通用的「撑满剩余高度、body 内滚、分页钉底」flex 样式
        // （R21 以报表立名，作用域即类名）；记录页复用同一行为，不另写一份 CSS
        className="gc-report-table"
        style={{ minHeight: RECORD_TABLE_MIN_HEIGHT }}
        scroll={{ y: '100%' }}
        pagination={{
          current: page,
          // 固定 15 条/页、无条数切换器、显示总条数（规则 5）
          pageSize: GLUCOSE_RECORD_PAGE_SIZE,
          total: data?.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* R25 复核弹窗：点血糖值 → review → 编辑；成功走 onGlucoseChanged（版本号 +1 →
          列表+统计重拉；作废成功后该行随之消失——服务端读路径恒排除 voided，裁定 Q2）。
          编辑/作废按钮的权限门控与审计都在弹窗/服务端既有实现里，本页零新增 */}
      <GlucoseReviewModal
        patient={patient}
        recordId={reviewRecordId}
        onClose={() => setReviewRecordId(null)}
        onChanged={onGlucoseChanged}
      />

      {/* R28：无头打印执行器（2026-11-26 裁定方案 B：删除预览 Modal，打印按钮直接
          唤起浏览器打印）——挂载即拉明文姓名（访问即留痕）与范围内全量记录；分页就绪
          后先留痕（GLUCOSE_PRINT）再触发浏览器打印（裁定 Q11），onDone 卸载并释放按钮 loading */}
      {printRunning ? (
        <GlucosePrintRunner
          printType="record"
          patient={patientDetail}
          range={appliedRange}
          onDone={() => setPrintRunning(false)}
        />
      ) : null}
    </div>
  );
}
