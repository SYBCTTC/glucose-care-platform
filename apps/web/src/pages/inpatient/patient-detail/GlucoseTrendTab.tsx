import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DotChartOutlined, LineChartOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Spin, message, theme } from 'antd';
import { useOutletContext, useParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { DICT_TYPE } from '@gc/shared';
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
import { useFullscreen } from '@/components/glucose/useFullscreen';
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
  const { glucoseVersion, onGlucoseChanged, patient } = useOutletContext<DetailChildContext>();
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
  const { data, loading, error, reload } = useGlucoseTrend(
    id,
    glucoseVersion,
    appliedRange,
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
  // ECharts 点击事件：从数据点附带的 recordId 定位记录（buildTrendOption 已埋入）
  const handleChartClick = useCallback((params: unknown) => {
    const recordId = (params as { data?: { recordId?: string } })?.data?.recordId;
    if (recordId) {
      setReviewRecordId(recordId);
    }
  }, []);

  // 换患者时退出全屏并重置查询表单：同一路由不同 :id 不会重挂载组件，state 需手动重置。
  // 表单置回 null（未就绪）→ 趋势请求挂起，等新患者的住院记录到达
  useEffect(() => {
    exitFullscreen();
    setQueryForm(null);
    setAppliedRange({});
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
          裁定：extra 插槽不使用——趋势页无追加筛选；展示勾选属报表专属，本页不渲染 */}
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
        {loading && !data ? (
          <div style={centerStyle}>
            <Spin />
          </div>
        ) : option ? (
          <>
            {/* 图表形态切换按钮：叠加在容器右上角（图例上方——图例已下移 top:32 让位）。
                文案/图标显示**目标**形态：当前折线→显示「散点图」，当前散点→显示「折线图」，点击来回切换 */}
            <Button
              size="small"
              icon={chartType === 'line' ? <DotChartOutlined /> : <LineChartOutlined />}
              onClick={() => setChartType(chartType === 'line' ? 'scatter' : 'line')}
              style={{ position: 'absolute', top: 0, right: 0, zIndex: 10 }}
            >
              {chartType === 'line' ? '散点图' : '折线图'}
            </Button>
            <ReactECharts
              ref={chartRef}
              option={option}
              // notMerge：数据/主题变化时整体替换 option，避免旧系列残留（点数与系列会变）
              notMerge
              style={{ height: '100%', width: '100%' }}
              onEvents={{ click: handleChartClick }}
            />
          </>
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
    </div>
  );
}
