import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfigProvider, theme as antdTheme } from 'antd';
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
import PrintReportDocument from './PrintReportDocument';
import PrintRecordDocument from './PrintRecordDocument';
import PrintTrendDocument from './PrintTrendDocument';
import { countVisibleReportRecords } from './buildPrintUnits';
import { DEFAULT_GLUCOSE_REPORT_DISPLAY } from '@/pages/inpatient/patient-detail/detail-tabs';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';

/**
 * R28：血糖打印**无头执行器**（2026-11-26 需求人裁定方案 B：删除预览 Modal，
 * 表单打印按钮直接唤起浏览器自带打印预览，无中间确认步骤）。
 *
 * 挂载 = 一次打印请求，流程：
 *  1. 并行拉【明文姓名（接口 1，访问即留痕）+ 打印数据】——报告/记录拉**已应用范围内
 *     全量**（裁定 B1），趋势直接用 Tab 传入的图表图片（裁定 C3 所见即所得）；
 *  2. 打印文档渲染进 body 层隐藏容器 `.gc-print-headless`（屏上离屏但保留布局，
 *     PrintPagedDocument 内测量层照常实测高度分页）；
 *  3. 就绪即打：报告/记录取 PrintPagedDocument 的 `onPagesReady`（实测分页产出后回调），
 *     趋势单页不分页、挂载即回调；
 *  4. 先留痕（GLUCOSE_PRINT，裁定 Q11）**成功后**才 `triggerBrowserPrint`
 *     （window.print 阻塞到打印对话框关闭）；留痕失败不打印（拦截器已 toast）；
 *  5. `onDone` 通知调用方卸载（释放打印按钮 loading）。
 *
 * 打印件恒白底黑字（规格 §4 规则 14），故内容子树套一层亮色 ConfigProvider。
 * 明文姓名请求失败/回 null 时回退 nameMasked（规格 §4 规则 15），不阻塞打印。
 */
export interface GlucosePrintRunnerProps {
  printType: 'report' | 'record' | 'trend';
  /** 完整患者详情（打印头患者信息数据源，壳层经 Outlet context 下发） */
  patient: PatientDetail;
  /** 已应用查询范围（R24 appliedRange）：打印数据拉取范围与留痕回显用它；时间范围行不用它（变更裁定 2026-11-25） */
  range: GlucosePrintRange;
  /** trend 必传：图表背后记录的 measuredAt 列表（时间范围行数据源；报告/记录由执行器自取） */
  trendDates?: string[];
  /** report 必传：R22 展示勾选（打印跟随勾选，规格 §4 规则 6） */
  reportDisplay?: GlucoseReportDisplay;
  /** trend 必传：Tab 触发打印时生成的图表图片（getDataURL，所见即所得） */
  chartImage?: string | null;
  /** trend 的审计计数（stats.total，裁定 17 沿用）；report/record 从拉取数据自取可见记录数（2026-11-26 裁定） */
  auditCount?: number;
  /** 流程结束回调（打印完成/留痕失败/取数失败/趋势缺图）：调用方据此卸载执行器 */
  onDone: () => void;
}

/** 字典未加载时的稳定空引用（同 GlucoseRecordTab 的 EMPTY_RESULT_TYPES：避免选择器每次返回新数组） */
const EMPTY_RESULT_TYPES: DictItemOption[] = [];

export default function GlucosePrintRunner({
  printType,
  patient,
  range,
  reportDisplay,
  chartImage,
  auditCount,
  trendDates,
  onDone,
}: GlucosePrintRunnerProps) {
  const resultTypes = useCommonDataStore(
    (state) => state.dicts[DICT_TYPE.GLUCOSE_RESULT] ?? EMPTY_RESULT_TYPES,
  );
  const timeSlots = useCommonDataStore((state) => state.timeSlots);

  const [namePlain, setNamePlain] = useState<string | null>(null);
  const [nameResolved, setNameResolved] = useState(false);
  const [reportData, setReportData] = useState<GlucoseReportResponse | null>(null);
  const [recordData, setRecordData] = useState<GlucoseRecordListResponse | null>(null);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    setNamePlain(null);
    setNameResolved(false);
    setReportData(null);
    setRecordData(null);

    // 趋势缺图表图片（图表未渲染）：无可打印内容，直接结束流程
    if (printType === 'trend' && !chartImage) {
      onDoneRef.current();
      return () => {
        cancelled = true;
      };
    }

    // 明文姓名：失败不致命（回退脱敏值），但需等它落定再挂载文档——
    // 头部姓名先脱敏后明文会改变头部内容，分页测量须在头部定稿后进行
    fetchPatientNamePlain(patient.id)
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
          : Promise.resolve(); // 趋势不取数（图表图片由 Tab 传入）

    // 取数失败：拦截器已按错误码 toast（无预览容器承载 Alert），直接结束流程
    dataTask.catch(() => {
      if (!cancelled) {
        onDoneRef.current();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [printType, patient.id, range.startTime, range.endTime, chartImage]);

  const dataReady =
    printType === 'trend'
      ? Boolean(chartImage)
      : printType === 'report'
        ? reportData !== null
        : recordData !== null;
  /** 文档挂载门控：明文姓名落定 + 数据就绪（头部定稿后再量分页） */
  const canMount = nameResolved && dataReady;

  /**
   * 审计/留痕条数 = **可见记录数**（2026-11-26 需求人裁定，与打印页脚「总计 Y 条」同口径）：
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

  const fired = useRef(false);
  const fire = useCallback(async () => {
    if (fired.current) {
      return;
    }
    fired.current = true;
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
      onDoneRef.current();
    }
  }, [patient.id, printType, range.startTime, range.endTime, totalCount]);

  /** 趋势单页不分页：挂载就绪即打；报告/记录等 onPagesReady（实测分页产出） */
  useEffect(() => {
    if (canMount && printType === 'trend') {
      void fire();
    }
  }, [canMount, printType, fire]);

  const handlePagesReady = useCallback(() => {
    void fire();
  }, [fire]);

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

  if (!canMount) {
    return null;
  }

  return createPortal(
    <ConfigProvider theme={{ algorithm: antdTheme.defaultAlgorithm }}>
      <div className="gc-print-headless" aria-hidden>
        {printType === 'report' && reportData ? (
          <PrintReportDocument
            data={reportData}
            display={reportDisplay ?? DEFAULT_GLUCOSE_REPORT_DISPLAY}
            resultTypes={resultTypes}
            patient={patient}
            plainName={namePlain}
            rangeText={rangeText}
            onPagesReady={handlePagesReady}
          />
        ) : printType === 'record' && recordData ? (
          <PrintRecordDocument
            data={recordData}
            resultTypes={resultTypes}
            timeSlots={timeSlots}
            patient={patient}
            plainName={namePlain}
            rangeText={rangeText}
            onPagesReady={handlePagesReady}
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
    </ConfigProvider>,
    document.body,
  );
}
