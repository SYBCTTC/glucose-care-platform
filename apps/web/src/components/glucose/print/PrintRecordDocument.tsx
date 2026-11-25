import { useMemo } from 'react';
import type {
  DictItemOption,
  GlucoseRecordListResponse,
  PatientDetail,
  TimeSlotOption,
} from '@gc/shared';
import PrintPagedDocument from '@/components/print/PrintPagedDocument';
import { PRINT_SUBTITLES } from '@/components/print/printConstants';
import { buildRecordPrintCounted, countedCodeSet } from './buildPrintUnits';
// 时间/时段/血糖值的格式化唯一事实来源（R27）：打印与屏幕共用，
// 血糖值保留色 + 文双通道（裁定 Q1，黑白打印下文字仍可辨）
import {
  buildRecordValue,
  formatMealContext,
  formatRecordTime,
} from '@/pages/inpatient/patient-detail/GlucoseRecordTab';

/**
 * R28：血糖记录打印文档（docs/specs/glucose-print.md §4 规则 7）。
 * 列与屏幕一致（检测时间/检测时段/血糖值/检测人/备注）；一行一个分页单元；
 * 数据 = 已应用范围内全量（fetchAllGlucoseRecords 产物，裁定 B1/Q12）。
 */

/** 列宽（px）：与屏幕列语义对应；备注列占余宽 */
const COL_WIDTHS = { time: 140, slot: 100, value: 90, operator: 100 } as const;

export interface PrintRecordDocumentProps {
  data: GlucoseRecordListResponse;
  resultTypes: DictItemOption[];
  timeSlots: TimeSlotOption[];
  patient: PatientDetail;
  plainName: string | null;
  rangeText: string;
}

export default function PrintRecordDocument({
  data,
  resultTypes,
  timeSlots,
  patient,
  plainName,
  rangeText,
}: PrintRecordDocumentProps) {
  const counted = useMemo(() => countedCodeSet(resultTypes), [resultTypes]);
  const countedFlags = useMemo(
    () => buildRecordPrintCounted(data.items, counted),
    [data.items, counted],
  );
  const units = useMemo(
    () => data.items.map((item, index) => ({ key: item.id, counted: countedFlags[index] })),
    [data.items, countedFlags],
  );
  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);

  const renderTable = (pageItemIds: string[]) => (
    <table className="gc-print-table">
      <colgroup>
        <col style={{ width: COL_WIDTHS.time }} />
        <col style={{ width: COL_WIDTHS.slot }} />
        <col style={{ width: COL_WIDTHS.value }} />
        <col style={{ width: COL_WIDTHS.operator }} />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>检测时间</th>
          <th>检测时段</th>
          <th>血糖值</th>
          <th>检测人</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        {pageItemIds.map((id) => {
          const item = itemById.get(id);
          if (!item) {
            return null;
          }
          const value = buildRecordValue(item, resultTypes);
          return (
            <tr key={id} data-print-unit="" data-print-unit-key={id}>
              <td className="gc-num">{formatRecordTime(item.measuredAt)}</td>
              <td>{formatMealContext(item.mealContext, timeSlots)}</td>
              <td style={{ color: value.color }}>
                <span className="gc-num">{value.text}</span>
              </td>
              <td>{item.operatorName ?? '-'}</td>
              <td>{item.remark ?? '-'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <PrintPagedDocument
      subtitle={PRINT_SUBTITLES.record}
      patient={patient}
      plainName={plainName}
      rangeText={rangeText}
      units={units}
      totalCount={data.stats.total}
      measureContent={renderTable(data.items.map((item) => item.id))}
      renderPageContent={(pageKeys) => renderTable(pageKeys)}
      measureVersion={units}
    />
  );
}
