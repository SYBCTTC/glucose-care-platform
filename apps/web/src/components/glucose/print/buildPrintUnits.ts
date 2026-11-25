import type {
  DictItemOption,
  GlucoseRecordListItem,
  GlucoseReportEntry,
  GlucoseReportResponse,
} from '@gc/shared';
import type { GlucoseReportDisplay } from '@/pages/inpatient/patient-detail/detail-tabs';
// 展示勾选过滤的唯一事实来源（R22 裁定 Q10：过滤只此一份，打印与屏幕共用）
import { filterReportRows } from '@/pages/inpatient/patient-detail/GlucoseReportTab';

/**
 * R28：打印分页单元的**纯构建函数**（docs/specs/glucose-print.md §4 规则 6/9/10）。
 * 全部可单测（buildPrintUnits.spec.ts）；DOM 测量/渲染在文档组件里。
 */

/** 报表打印的一个分页单元 = 一个日期组（rowspan 合格，组是原子的、不跨页拆，裁定 C1） */
export interface ReportPrintRow {
  /** 该条记录落在 data.columns 的第几个时段列 */
  slotIndex: number;
  entry: GlucoseReportEntry;
}

export interface ReportPrintUnit {
  /** 单元键 = 日期（YYYY-MM-DD），与行上的 data-print-unit-key 一致 */
  key: string;
  date: string;
  /** 该日期下全部可见记录，按列序（columns 顺序）排列；同列内保持服务端升序 */
  rows: ReportPrintRow[];
  /** 该组内 counted=true 的记录数（页脚「本页 X 条」累加用） */
  counted: number;
}

/**
 * counted 码集合：**动态跟随字典 `counted=true`**（裁定 Q2，与统计栏「总计」同口径）。
 * 禁止硬编码排除 5~9——临床改字典（如把某类重新计入）打印页脚自动跟随。
 */
export function countedCodeSet(resultTypes: DictItemOption[]): Set<string> {
  return new Set(resultTypes.filter((option) => option.counted).map((option) => option.code));
}

/**
 * 报表响应 → 打印分页单元。
 *
 * - 先走 `filterReportRows`（常规/强化勾选过滤，与屏幕同一实现）；
 * - 每个日期组内把各时段格的记录摊平成行：每条记录独占一行、落对应时段列
 *   （裁定 C1，与屏幕「同格多条挤一个 td」不同）；
 * - 行按列序排列（Array.sort 稳定，同列内保持 entries 的时间升序）；
 * - **无可见记录的日期整组跳过**（规格 §4 裁定 16：屏幕保留空行是为分页 total
 *   口径，打印无此约束，空行只是噪音）。
 */
export function buildReportPrintUnits(
  data: GlucoseReportResponse,
  display: GlucoseReportDisplay,
  counted: Set<string>,
): ReportPrintUnit[] {
  const slotIndexOf = new Map(data.columns.map((column, index) => [column.code, index]));
  const units: ReportPrintUnit[] = [];

  for (const row of filterReportRows(data.rows, display)) {
    const rows: ReportPrintRow[] = [];
    row.cells.forEach((cell) => {
      const slotIndex = slotIndexOf.get(cell.slotCode);
      if (slotIndex === undefined) {
        return; // 防御：列集合外的格（正常不发生，columns 与 cells 同源）
      }
      for (const entry of cell.entries) {
        rows.push({ slotIndex, entry });
      }
    });
    if (rows.length === 0) {
      continue;
    }
    rows.sort((a, b) => a.slotIndex - b.slotIndex);
    units.push({
      key: row.date,
      date: row.date,
      rows,
      counted: rows.filter((row_) => counted.has(row_.entry.resultType)).length,
    });
  }
  return units;
}

/** 记录列表 → 每条的 counted 计数（记录打印一行一个单元；页脚「本页 X 条」用） */
export function buildRecordPrintCounted(
  items: GlucoseRecordListItem[],
  counted: Set<string>,
): number[] {
  return items.map((item) => (counted.has(item.resultType) ? 1 : 0));
}
