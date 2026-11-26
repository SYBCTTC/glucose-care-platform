import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DotChartOutlined, LineChartOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Empty, Spin, message, theme } from 'antd';
import { useOutletContext, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { DICT_TYPE, PERMISSION } from '@gc/shared';
import type { DictItemOption } from '@gc/shared';
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
import { PRINT_IMAGE_BACKGROUND } from '@/components/print/printConstants';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import { useThemeStore } from '@/store/theme';
import { buildTrendOption } from '@/styles/chartTheme';
import type { TrendChartType } from '@/styles/chartTheme';
import type { DetailChildContext } from './detail-tabs';
import GlucoseReviewModal from './GlucoseReviewModal';
import { buildReportStatsItems } from './buildReportStatsItems';
import { useGlucoseTrend } from './useGlucoseTrend';
import type { GlucoseTrendRange } from './useGlucoseTrend';
import { useAdmissions } from './useAdmissions';

/**
 * P3-7：血糖趋势图（路由 `/inpatient/patients/:id/glucose/trend`）。
 * 规格 docs/specs/glucose-trend.md（2026-11-24 需求人 4 项裁定）。
 *
 * 复用面（零改动）：R24 表单联动状态机（GlucoseQueryForm + useAdmissions + 默认态推导）、
 * R26 公共件（GlucoseToolbar 统计栏/全屏、useFullscreen({onResize})）、R25 复核弹窗
 * （点数据点 → review → edit）、报表统计口径（buildReportStatsItems，裁定：同范围与报表/记录同数字）。
 * 本页特有：ECharts **时间轴散点图**（原始测量点，裁定：不做按日聚合），按结果类型字典色分三系列，
 * 叠加低/高阈值线与目标范围带（阈值由接口下发，裁定：沿用告警阈值）。**不分页**。
 * 明确不做：按日聚合/TIR 等趋势专属指标、「含作废」开关（作废记录任何读路径不可见）。
 */

/** 图表区最小高度：极矮视口下的防塌缩兜底（同报表/记录的 minHeight 思路） */
const CHART_MIN_HEIGHT = 320;

/**
 * 字典缺失时的稳定空值。必须是**模块级常量**：
 * 若在 selector 里写 `?? []`，每次调用都产生新数组，zustand 用 `Object.is` 比较会判定
 * "状态变了" → 无限重渲染（同 GlucoseRecordTab 的 EMPTY_RESULT_TYPES）。
 */
const EMPTY_RESULT_TYPES: DictItemOption[] = [];

export default function GlucoseTrendTab() {
  const { id } = useParams<{ id: string }>();
  const { glucoseVersion, onGlucoseChanged, patient, patientDetail } =
    useOutletContext<DetailChildContext>();
  const { token } = theme.useToken();
  const mode = useThemeStore((state) => state.mode);
  // R23/R26：全屏态走公共 hook；趋势图接 onResize → chart.resize()（glucose-domain 图表节：
  // 全屏是纯 CSS 覆盖层、不触发浏览器 fullscreen 事件，必须靠该回调重算画布尺寸）
  const chartRef = useRef<ReactECharts>(null);
  const {
    fullscreen,
    toggle,
    exit: exitFullscreen,
    overlayStyle,
  } = useFullscreen({
    onResize: () => chartRef.current?.getEchartsInstance().resize(),
  });
  // R24 状态机：表单态与**已应用**范围分离——改表单不触发请求，点「查询」/初始默认态/重置才应用
  const admissions = useAdmissions(id);
  const [queryForm, setQueryForm] = useState<GlucoseQueryFormState | null>(null);
  const [appliedRange, setAppliedRange] = useState<GlucoseTrendRange>({});

  // 时段过滤（P3-7 增补，2026-11-24 需求人裁定）：选项 =「全部」+ 所有启用时段（普通+特殊+强化，与录入下拉一致）。
  // 状态记录用户**取消勾选**的时段集合（默认空 = 全选 =「全部」）：时段是异步加载的，
  // 用「取消集」可免掉「时段到达后重置」的 effect——selectedCodes 始终由 enabledCodes 减去取消集派生。
  const timeSlots = useCommonDataStore((state) => state.timeSlots);
  const enabledSlots = useMemo(() => timeSlots.filter((slot) => slot.enabled), [timeSlots]);
  const enabledCodes = useMemo(() => enabledSlots.map((slot) => slot.code), [enabledSlots]);
  const [uncheckedSlots, setUncheckedSlots] = useState<Set<string>>(() => new Set());
  const selectedCodes = useMemo(
    () => enabledCodes.filter((code) => !uncheckedSlots.has(code)),
    [enabledCodes, uncheckedSlots],
  );
  const allSlotsChecked = selectedCodes.length === enabledCodes.length;
  // 「全部」（全选）= 不发 mealContexts（不过滤，含停用时段的历史记录，与默认视图一致）；
  // 部分勾选 = 发选中码（逗号分隔）→ 后端按 mealContext IN 过滤点并重算统计（口径与报表一致）
  const mealContextsParam = useMemo(
    () => (allSlotsChecked ? undefined : selectedCodes.join(',')),
    [allSlotsChecked, selectedCodes],
  );

  const { data, loading, error, reload } = useGlucoseTrend(
    id,
    glucoseVersion,
    appliedRange,
    mealContextsParam,
    queryForm !== null,
  );
  // 字典只在这里订阅一次再传下去（同记录页：避免逐点订阅）
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );

  // R25 复核弹窗（点数据点打开）：编辑/作废成功走 onGlucoseChanged → 版本号 +1 → 趋势重拉
  const [reviewRecordId, setReviewRecordId] = useState<string | null>(null);
  // 图表形态切换（P3-7 增补）：默认折线图；容器右上角按钮在折线↔散点间切换，按钮文案/图标显示**目标**形态
  const [chartType, setChartType] = useState<TrendChartType>('line');

  // R28：打印门控（裁定 Q5/Q6/B3）——无 glucose:print 不传 onPrint（按钮不渲染，服务端接口兜底）；
  // 无数值型点（不成图）时禁用。趋势打印不取数：点击打印瞬间把当前图表转成图片（裁定 C3
  // 所见即所得——含当前时段过滤与折线/散点形态），pixelRatio 2 保证清晰度、白底（规格 §4 规则 14）
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canPrint = hasPermission(PERMISSION.GLUCOSE_PRINT);
  const [printRunning, setPrintRunning] = useState(false);
  const [chartImage, setChartImage] = useState<string | null>(null);
  const handlePrint = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    setChartImage(
      instance
        ? instance.getDataURL({ pixelRatio: 2, backgroundColor: PRINT_IMAGE_BACKGROUND })
        : null,
    );
    setPrintRunning(true);
  }, []);
  /** 图表背后记录的 measuredAt（Modal 时间范围行数据源，2026-11-25 变更裁定：范围行依据数据不依据筛选） */
  const trendDates = useMemo(() => data?.points.map((point) => point.measuredAt) ?? [], [data]);
  // ECharts 点击事件：从数据点附带的 recordId 定位记录（buildTrendOption 已埋入）
  const handleChartClick = useCallback((params: unknown) => {
    const recordId = (params as { data?: { recordId?: string } })?.data?.recordId;
    if (recordId) {
      setReviewRecordId(recordId);
    }
  }, []);

  // 点「全部」：所有启用时段勾上（回到默认视图）= 清空取消集（裁定 #4）。
  // 已全选时再点仍清空 → 保持全选，不会反选成空（与「至少 1 个时段」一致）
  const handleSelectAllSlots = useCallback(() => setUncheckedSlots(new Set()), []);
  // 勾选/取消单个时段：勾选 = 从取消集移除；取消 = 加入取消集，但须保留 ≥1 个时段——
  // 取消最后一个时弹提示并拦截（裁定 #3，同报表 toggleDisplay 的最少 1 项口径）。
  // 副作用（message.warning）放在 updater 外，避免 StrictMode 下 updater 双调用重复弹提示
  const handleToggleSlot = useCallback(
    (code: string, checked: boolean) => {
      if (checked) {
        setUncheckedSlots((prev) => {
          if (!prev.has(code)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(code);
          return next;
        });
        return;
      }
      if (selectedCodes.length <= 1) {
        void message.warning('请至少选择一个时段');
        return;
      }
      setUncheckedSlots((prev) => {
        if (prev.has(code)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(code);
        return next;
      });
    },
    [selectedCodes.length],
  );

  // 换患者时退出全屏并重置查询表单：同一路由不同 :id 不会重挂载组件，state 需手动重置。
  // 表单置回 null（未就绪）→ 趋势请求挂起，等新患者的住院记录到达
  useEffect(() => {
    exitFullscreen();
    setQueryForm(null);
    setAppliedRange({});
    // 换患者时段过滤回到默认（全选）：取消集清空，避免沿用上一患者的时段选择
    setUncheckedSlots(new Set());
  }, [id, exitFullscreen]);

  // R24（裁定 Q15）：住院记录就绪 → 初始化默认表单态并自动按默认条件查询；
  // 请求失败 → 退化为「全部 + 无限制」可用态，不阻塞图表本体
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

  // R24：查询——校验开始≤结束（裁定 Q13）后应用范围（趋势不分页，无需回到第 1 页）
  const handleSearch = () => {
    if (!queryForm) {
      return;
    }
    if (isRangeInverted(queryForm)) {
      void message.warning('开始时间不能晚于结束时间');
      return;
    }
    setAppliedRange(toQueryRange(queryForm));
  };

  // R24：重置 = 恢复进入页面时的默认态并自动查询（裁定 Q17），不是清空
  const handleReset = () => {
    if (!admissions.data) {
      return;
    }
    const defaults = deriveQueryDefaults(admissions.data);
    setQueryForm(defaults);
    setAppliedRange(toQueryRange(defaults));
  };

  // 图表 option：仅在有点数据时构建（阈值随接口下发，空数据走 Empty 态）。
  // mode/resultTypes/chartType 进依赖：明暗切换、字典到达或折线/散点切换时重建，颜色、图例文案与系列 type 跟随
  const option = useMemo(
    () =>
      data && data.points.length > 0
        ? buildTrendOption({
            points: data.points,
            thresholds: data.thresholds,
            mode,
            resultTypes,
            chartType,
          })
        : null,
    [data, mode, resultTypes, chartType],
  );

  // 统计栏：与报表/记录同一构建函数（裁定：复用报表口径，同范围下数字完全一致）。
  // data 未到时不传 → 统计区不渲染、全屏按钮仍靠右（GlucoseToolbar 既有行为）
  const statsItems = useMemo(
    () => (data ? buildReportStatsItems(data.stats, resultTypes) : undefined),
    [data, resultTypes],
  );

  // 根节点布局同报表/记录（R21/R23 口径）：撑满内容区、工具栏固定、图表占剩余空间；
  // 全屏态叠加 useFullscreen 的 fixed 覆盖样式
  const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    overflow: 'auto',
    ...overlayStyle,
  };

  // 图表容器：占满剩余高度；position relative 让居中的 loading/空态有定位参照
  const chartBoxStyle: CSSProperties = {
    flex: 1,
    minHeight: CHART_MIN_HEIGHT,
    position: 'relative',
  };

  const centerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <div style={rootStyle}>
      {/* R26 公共工具栏：统计栏（左）+ 查询表单（中）+ 全屏按钮（右）。
          裁定：extra 插槽不使用——时段过滤放在下方图表区顶部覆盖行（紧贴图例，勾选即所见即所滤），
          不挤进工具栏；展示勾选属报表专属，本页不渲染 */}
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
            onPrint={canPrint ? handlePrint : undefined}
            printDisabled={!data || data.points.length === 0}
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

      <div style={chartBoxStyle}>
        {/* 顶部覆盖行：时段过滤（左，限宽横向滚动）+ 图表形态切换按钮（右）。
            data 就绪即渲染——空态下用户仍需能重新勾选时段，故不能随 Empty 一起隐藏。
            行高 ~22px，落在图表图例（top:32）上方，不挤压绘图区（裁定：图表布局不变） */}
        {data ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: token.marginXS,
            }}
          >
            {/* 时段过滤：「全部」+ 所有启用时段（裁定：单行横向滚动，见 .gc-slot-filter）。
                「全部」点击 = 全选（部分选中时 indeterminate）；单项切换走 handleToggleSlot（含最少 1 时段拦截） */}
            <div className="gc-slot-filter" style={{ flex: 1, minWidth: 0 }}>
              <Checkbox
                checked={allSlotsChecked}
                indeterminate={!allSlotsChecked && selectedCodes.length > 0}
                onChange={handleSelectAllSlots}
              >
                全部
              </Checkbox>
              {enabledSlots.map((slot) => (
                <Checkbox
                  key={slot.code}
                  checked={!uncheckedSlots.has(slot.code)}
                  onChange={(event) => handleToggleSlot(slot.code, event.target.checked)}
                >
                  {slot.name}
                </Checkbox>
              ))}
            </div>
            {/* 图表形态切换按钮：文案/图标显示**目标**形态（当前折线→「散点图」，当前散点→「折线图」），点击来回切换 */}
            <Button
              size="small"
              icon={chartType === 'line' ? <DotChartOutlined /> : <LineChartOutlined />}
              onClick={() => setChartType(chartType === 'line' ? 'scatter' : 'line')}
              style={{ flexShrink: 0 }}
            >
              {chartType === 'line' ? '散点图' : '折线图'}
            </Button>
          </div>
        ) : null}
        {loading && !data ? (
          <div style={centerStyle}>
            <Spin />
          </div>
        ) : option ? (
          <ReactECharts
            ref={chartRef}
            option={option}
            // notMerge：数据/主题变化时整体替换 option，避免旧系列残留（点数与系列会变）
            notMerge
            style={{ height: '100%', width: '100%' }}
            onEvents={{ click: handleChartClick }}
          />
        ) : (
          <div style={centerStyle}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该范围无数值型血糖记录" />
          </div>
        )}
      </div>

      {/* R25 复核弹窗：点数据点 → review → 编辑；成功走 onGlucoseChanged（版本号 +1 → 趋势重拉；
          作废成功后该点随之消失——服务端读路径恒排除 voided）。编辑/作废权限门控与审计都在
          弹窗/服务端既有实现里，本页零新增 */}
      <GlucoseReviewModal
        patient={patient}
        recordId={reviewRecordId}
        onClose={() => setReviewRecordId(null)}
        onChanged={onGlucoseChanged}
      />

      {/* R28：无头打印执行器（2026-11-26 裁定方案 B：删除预览 Modal，打印按钮直接
          唤起浏览器打印）——趋势图不取数，直接用点击时生成的图表图片；单页不分页、
          无页脚（裁定 Q3/C3）。挂载后先留痕（GLUCOSE_PRINT）再触发浏览器打印（裁定 Q11） */}
      {printRunning ? (
        <GlucosePrintRunner
          printType="trend"
          patient={patientDetail}
          range={appliedRange}
          chartImage={chartImage}
          auditCount={data?.stats.total ?? 0}
          trendDates={trendDates}
          onDone={() => setPrintRunning(false)}
        />
      ) : null}
    </div>
  );
}
