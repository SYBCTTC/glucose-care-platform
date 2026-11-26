import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, ConfigProvider, Modal, Spin, theme as antdTheme } from 'antd';
import { DICT_TYPE } from '@gc/shared';
import type {
  DictItemOption,
  GlucoseRecordListResponse,
  GlucoseReportResponse,
  PatientDetail,
} from '@gc/shared';
import { fetchAllGlucoseRecords, fetchAllGlucoseReport, reportGlucosePrint } from '@/api/glucose';
import type { GlucosePrintRange } from '@/api/glucose';
import { fetchPatientNamePlain } from '@/api/patient';
import { useCommonDataStore } from '@/store/common-data';
import { triggerBrowserPrint } from '@/components/print/printBrowser';
import { formatPrintRangeFromDates } from '@/components/print/paginate';
import { countVisibleReportRecords } from './buildPrintUnits';
import { PRINT_PAGE_WIDTH_PX } from '@/components/print/printConstants';
import PrintReportDocument from './PrintReportDocument';
import PrintRecordDocument from './PrintRecordDocument';
import PrintTrendDocument from './PrintTrendDocument';
import { DEFAULT_GLUCOSE_REPORT_DISPLAY } from '@/pages/inpatient/patient-detail/detail-tabs';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';

/**
 * R28：血糖数据打印预览 Modal（docs/specs/glucose-print.md §6），三个子 Tab 共用。
 *
 * 职责：
 *  1. 打开时并行拉【明文姓名（接口 1，访问即留痕）+ 打印数据】——报告/记录拉
 *     **已应用范围内全量**（裁定 B1），趋势图直接用 Tab 传入的图表图片（裁定 C3）；
 *  2. 预览：1:1 A4 页（分页效果所见即所得）；打印件恒白底黑字（规格 §4 规则 14），
 *     故内容子树套一层亮色 ConfigProvider——暗色模式下 ReportCell 等组件的
 *     token 色（分隔线/次级文字）也按亮色渲染，与打印输出一致；
 *  3. 点「打印」：先调留痕接口（GLUCOSE_PRINT，裁定 Q11），**成功后**才触发
 *     window.print；留痕失败不打印（拦截器已 toast）。
 *
 * 明文姓名请求失败/回 null 时回退 nameMasked（规格 §4 规则 15），不阻塞打印。
 */

export interface GlucosePrintModalProps {
  open: boolean;
  onClose: () => void;
  printType: 'report' | 'record' | 'trend';
  /** 完整患者详情（打印头患者信息数据源，壳层经 Outlet context 下发） */
  patient: PatientDetail;
  /** 已应用查询范围（R24 appliedRange）：打印数据拉取范围与留痕回显用它；时间范围行不用它（变更裁定 2026-11-25） */
  range: GlucosePrintRange;
  /** trend 必传：图表背后记录的 measuredAt 列表（时间范围行数据源；报告/记录由 Modal 自取） */
  trendDates?: string[];
  /** report 必传：R22 展示勾选（打印跟随勾选，规格 §4 规则 6） */
  reportDisplay?: GlucoseReportDisplay;
  /** trend 必传：Tab 打开预览时生成的图表图片（getDataURL，所见即所得） */
  chartImage?: string | null;
  /** trend 的审计计数（stats.total，裁定 17 沿用——趋势打印的是图表、无记录列表可数）；
      report/record 从拉取数据自取可见记录数（2026-11-26 裁定） */
  auditCount?: number;
}

type Phase = 'loading' | 'ready' | 'error';

/** 预览容器左右留白（px，屏幕装饰，打印时被 global.css 归零） */
const PREVIEW_PADDING = 16;

/** 字典未加载时的稳定空引用（同 GlucoseRecordTab 的 EMPTY_RESULT_TYPES：避免选择器每次返回新数组） */
const EMPTY_RESULT_TYPES: DictItemOption[] = [];

export default function GlucosePrintModal({
  open,
  onClose,
  printType,
  patient,
  range,
  reportDisplay,
  chartImage,
  auditCount,
  trendDates,
}: GlucosePrintModalProps) {
  const { token } = antdTheme.useToken();
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );
  const timeSlots = useCommonDataStore((state) => state.timeSlots);

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [namePlain, setNamePlain] = useState<string | null>(null);
  const [nameResolved, setNameResolved] = useState(false);
  const [reportData, setReportData] = useState<GlucoseReportResponse | null>(null);
  const [recordData, setRecordData] = useState<GlucoseRecordListResponse | null>(null);
  const [printing, setPrinting] = useState(false);
  /**
   * Modal 开合动画期间 .ant-modal 带 transform（缩放），getBoundingClientRect 量到的是
   * 缩放后高度、分页会算错——afterOpenChange 置 true 后才渲染文档并测量（裁定 D1 前提）。
   */
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setNamePlain(null);
    setNameResolved(false);
    setReportData(null);
    setRecordData(null);

    // 明文姓名：失败不致命（回退脱敏值），但需等它落定再出预览，避免姓名先脱敏后明文的闪变
    const nameTask = fetchPatientNamePlain(patient.id)
      .then((result) => {
        if (!cancelled) {
          setNamePlain(result.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNamePlain(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNameResolved(true);
        }
      });

    const dataTask =
      printType === 'report'
        ? fetchAllGlucoseReport(patient.id, range).then((data) => {
            if (!cancelled) {
              setReportData(data);
            }
          })
        : printType === 'record'
          ? fetchAllGlucoseRecords(patient.id, range).then((data) => {
              if (!cancelled) {
                setRecordData(data);
              }
            })
          : Promise.resolve(); // 趋势图不取数（图表图片由 Tab 传入）

    void (async () => {
      try {
        await dataTask;
        if (!cancelled) {
          setPhase('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error && e.message ? e.message : '加载打印数据失败');
          setPhase('error');
        }
      }
      await nameTask;
    })();

    return () => {
      cancelled = true;
    };
    // range 是对象，按原始值订阅（appliedRange 在 Tab 层已 memo，此处再防一层）
  }, [open, printType, patient.id, range.startTime, range.endTime]);

  /**
   * 审计/留痕条数 = **可见记录数**（2026-11-26 需求人裁定，替代裁定 17 的 stats.total
   * counted 口径；与打印页脚「总计 Y 条」同口径）：
   *  - report：展示勾选过滤后的 entry 总条数（含拒检/请假等 5~9）；
   *  - record：范围内全部记录条数（记录打印不做勾选过滤）；
   *  - trend：打印的是图表图片、无记录列表，沿用 Tab 传入的 stats.total（裁定 17）。
   */
  const totalCount =
    printType === 'report' && reportData
      ? countVisibleReportRecords(reportData, reportDisplay ?? DEFAULT_GLUCOSE_REPORT_DISPLAY)
      : printType === 'record' && recordData
        ? recordData.items.length
        : (auditCount ?? 0);

  const handlePrint = useCallback(async () => {
    setPrinting(true);
    try {
      // 裁定 Q11：先留痕后打印；留痕失败（网络/权限）则不触发 window.print
      await reportGlucosePrint(patient.id, {
        printType,
        startTime: range.startTime,
        endTime: range.endTime,
        count: totalCount,
      });
      triggerBrowserPrint();
    } catch {
      // 拦截器已按错误码 toast；此处只需不打印
    } finally {
      setPrinting(false);
    }
  }, [patient.id, printType, range.startTime, range.endTime, totalCount]);

  const dataReady =
    phase === 'ready' &&
    nameResolved &&
    (printType === 'trend'
      ? Boolean(chartImage)
      : printType === 'report'
        ? reportData !== null
        : recordData !== null);
  /** 时间范围行（2026-11-25 变更裁定）：依据打印文档数据的最早/最晚测量日期，不依据筛选条件 */
  const rangeText = useMemo(() => {
    if (printType === 'report') {
      return formatPrintRangeFromDates(reportData?.rows.map((row) => row.date) ?? []);
    }
    if (printType === 'record') {
      return formatPrintRangeFromDates(recordData?.items.map((item) => item.measuredAt) ?? []);
    }
    return formatPrintRangeFromDates(trendDates ?? []);
  }, [printType, reportData, recordData, trendDates]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      afterOpenChange={setShown}
      title="打印预览"
      // 宽度 = A4 页宽 + 预览留白 + Modal 内容内边距(48) + 纵向滚动条余量(48)：
      // 原 +48 恰好等于页宽+留白，纵向滚动条占宽后出现横向滚动（2026-11-25 修复）
      width={PRINT_PAGE_WIDTH_PX + PREVIEW_PADDING * 2 + 96}
      // 上边距：antd 默认 100px 太高，需求人裁定改 20px（2026-11-25，作用于 .ant-modal）
      style={{ top: 20 }}
      styles={{ body: { padding: 0 } }}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="print"
          type="primary"
          loading={printing}
          disabled={!dataReady}
          onClick={handlePrint}
        >
          打印
        </Button>,
      ]}
    >
      {/* 打印件恒亮色（白底黑字，规格 §4 规则 14）：内容子树强制亮色算法，
          暗色模式下 ReportCell/RecordValue 的 token 色才与打印输出一致 */}
      <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
        <div
          className="gc-print-preview"
          style={{
            padding: PREVIEW_PADDING,
            maxHeight: '80vh',
            overflowY: 'auto',
            overflowX: 'hidden',
            background: token.colorFillTertiary,
          }}
        >
          {!dataReady || !shown ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin />
              <div style={{ marginTop: 8, color: token.colorTextSecondary }}>
                {phase === 'error' ? '' : '正在加载打印数据...'}
              </div>
              {phase === 'error' ? (
                <Alert
                  type="error"
                  showIcon
                  message={error ?? '加载打印数据失败'}
                  style={{ marginTop: 16 }}
                />
              ) : null}
            </div>
          ) : printType === 'report' && reportData ? (
            <PrintReportDocument
              data={reportData}
              display={reportDisplay ?? DEFAULT_GLUCOSE_REPORT_DISPLAY}
              resultTypes={resultTypes}
              patient={patient}
              plainName={namePlain}
              rangeText={rangeText}
            />
          ) : printType === 'record' && recordData ? (
            <PrintRecordDocument
              data={recordData}
              resultTypes={resultTypes}
              timeSlots={timeSlots}
              patient={patient}
              plainName={namePlain}
              rangeText={rangeText}
            />
          ) : printType === 'trend' && chartImage ? (
            <PrintTrendDocument
              chartImage={chartImage}
              patient={patient}
              plainName={namePlain}
              rangeText={rangeText}
            />
          ) : null}
        </div>
      </ConfigProvider>
    </Modal>
  );
}
