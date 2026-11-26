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
 * 与屏幕的差异（2026-11-26 变更裁定，替代原裁定 C1「每条独占一行」）：
 * 屏幕同格多条纵向堆叠，打印用**对齐子行**——同日行数 = 该日单时段最大记录数，
 * 每个时段第 i 条（检测时间升序）落第 i 行、缺位留空；不含统计栏。
 * 分页单元 = 子行（实测高度自适应装满），日期组可跨页，
 * 日期列按「页内连续同日期片段」合并——同日期跨两页时两页各自合并。
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
  /** 透传 PrintPagedDocument：实测分页产出后回调（无头打印执行器的「可打印」信号） */
  onPagesReady?: () => void;
}

export default function PrintReportDocument({
  data,
  display,
  resultTypes,
  patient,
  plainName,
  rangeText,
  onPagesReady,
}: PrintReportDocumentProps) {
  const counted = useMemo(() => countedCodeSet(resultTypes), [resultTypes]);
  const units = useMemo(
    () => buildReportPrintUnits(data, display, counted),
    [data, display, counted],
  );
  const unitByKey = useMemo(() => new Map(units.map((unit) => [unit.key, unit])), [units]);

  /** 测量层与真实页共用同一渲染（量到的高度 = 实际打印高度） */
  const renderTable = (pageRows: ReportPrintUnit[]) => {
    // 日期列：页内连续同日期行合并；同日期被拆到两页时两页各自合并自己的片段
    const spans = pageRows.map(() => 0);
    pageRows.forEach((row, index) => {
      if (index === 0 || row.date !== pageRows[index - 1].date) {
        let length = 1;
        while (index + length < pageRows.length && pageRows[index + length].date === row.date) {
          length += 1;
        }
        spans[index] = length;
      }
    });
    return (
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
          {pageRows.map((row, index) => (
            <tr key={row.key} data-print-unit="" data-print-unit-key={row.key}>
              {spans[index] > 0 ? (
                <td rowSpan={spans[index]} className="gc-num">
                  {row.date}
                </td>
              ) : null}
              {data.columns.map((column, columnIndex) => {
                const entry = row.cells[columnIndex];
                return (
                  <td key={column.code}>
                    {entry ? (
                      <ReportCell
                        cell={{ slotCode: column.code, entries: [entry] }}
                        resultTypes={resultTypes}
                        display={display}
                      />
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <PrintPagedDocument
      subtitle={PRINT_SUBTITLES.report}
      patient={patient}
      plainName={plainName}
      rangeText={rangeText}
      units={units.map((unit) => ({
        key: unit.key,
        counted: unit.counted,
        visible: unit.visible,
      }))}
      measureContent={renderTable(units)}
      renderPageContent={(pageKeys) =>
        renderTable(
          pageKeys
            .map((key) => unitByKey.get(key))
            .filter((unit): unit is ReportPrintUnit => unit !== undefined),
        )
      }
      measureVersion={units}
      onPagesReady={onPagesReady}
    />
  );
}
