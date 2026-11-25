import { useMemo } from 'react';
import type { DictItemOption, GlucoseReportResponse, PatientDetail } from '@gc/shared';
import PrintPagedDocument from '@/components/print/PrintPagedDocument';
import { PRINT_SUBTITLES } from '@/components/print/printConstants';
import { buildReportPrintUnits, countedCodeSet } from './buildPrintUnits';
import type { ReportPrintUnit } from './buildPrintUnits';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';
// 单元格渲染的唯一事实来源（R22/R25）：打印直接复用 ReportCell——
// 不传 onEntryClick/onEmptyClick 即静态渲染（其 props 注释明确支持打印场景），
// 值/字典名/检测时间/来源时段/操作人行的展示逻辑与屏幕逐条一致（规格 §4 规则 6）
import { ReportCell } from '@/pages/inpatient/patient-detail/GlucoseReportTab';

/**
 * R28：血糖报告打印文档（docs/specs/glucose-print.md §4 规则 6/9/10）。
 *
 * 与屏幕的差异（裁定 C1）：同一日期同一时段的多条记录**每条独占一行**，
 * 日期列 rowspan 跨行合并；记录落对应时段列、其余列留空；不含统计栏。
 * 分页单元 = 日期组（原子，不跨页拆组，否则 rowspan 断裂）。
 */

/** 日期列宽（px）：容纳 YYYY-MM-DD（12px 字号）+ 单元格内边距；时段列均分余宽 */
const DATE_COL_WIDTH = 84;

export interface PrintReportDocumentProps {
  /** 已应用范围内的全量报表数据（fetchAllGlucoseReport 产物） */
  data: GlucoseReportResponse;
  /** R22 展示勾选（打印跟随勾选，规格 §4 规则 6） */
  display: GlucoseReportDisplay;
  resultTypes: DictItemOption[];
  patient: PatientDetail;
  plainName: string | null;
  rangeText: string;
}

export default function PrintReportDocument({
  data,
  display,
  resultTypes,
  patient,
  plainName,
  rangeText,
}: PrintReportDocumentProps) {
  const counted = useMemo(() => countedCodeSet(resultTypes), [resultTypes]);
  const units = useMemo(
    () => buildReportPrintUnits(data, display, counted),
    [data, display, counted],
  );
  const unitByKey = useMemo(() => new Map(units.map((unit) => [unit.key, unit])), [units]);

  /** 测量层与真实页共用同一渲染（量到的高度 = 实际打印高度） */
  const renderTable = (pageUnits: ReportPrintUnit[]) => (
    <table className="gc-print-table">
      <colgroup>
        <col style={{ width: DATE_COL_WIDTH }} />
        {data.columns.map((column) => (
          <col key={column.code} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th>日期</th>
          {data.columns.map((column) => (
            <th key={column.code}>{column.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {pageUnits.map((unit) =>
          unit.rows.map((row, rowIndex) => (
            <tr key={`${unit.key}-${rowIndex}`} data-print-unit="" data-print-unit-key={unit.key}>
              {rowIndex === 0 ? (
                <td rowSpan={unit.rows.length} className="gc-num">
                  {unit.date}
                </td>
              ) : null}
              {data.columns.map((column, columnIndex) => (
                <td key={column.code}>
                  {row.slotIndex === columnIndex ? (
                    <ReportCell
                      cell={{ slotCode: column.code, entries: [row.entry] }}
                      resultTypes={resultTypes}
                      display={display}
                    />
                  ) : null}
                </td>
              ))}
            </tr>
          )),
        )}
      </tbody>
    </table>
  );

  return (
    <PrintPagedDocument
      subtitle={PRINT_SUBTITLES.report}
      patient={patient}
      plainName={plainName}
      rangeText={rangeText}
      units={units.map((unit) => ({ key: unit.key, counted: unit.counted }))}
      totalCount={data.stats.total}
      measureContent={renderTable(units)}
      renderPageContent={(pageKeys) =>
        renderTable(
          pageKeys
            .map((key) => unitByKey.get(key))
            .filter((unit): unit is ReportPrintUnit => unit !== undefined),
        )
      }
      measureVersion={units}
    />
  );
}
