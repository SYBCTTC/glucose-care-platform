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

/**
 * 报表打印的一个分页单元 = **对齐子行**（2026-11-26 需求人变更裁定）。
 * 演进史：
 *  - 原「日期组原子、不跨页拆」→ 装不下的下一组整体推去新页、首页大量留白；
 *  - 2026-11-25「行级（每条记录独占一行）」→ 留白解决，但一行只有一列有值、
 *    同日多时段不横向对齐，行数膨胀（空腹2+早餐后2+午餐后1 = 5 行）；
 *  - 现「对齐子行」→ 同日行数 = 该日单时段最大记录数，每个时段的第 i 条
 *    （检测时间升序）落第 i 行、缺位留空（上例 = 2 行：行1 三个值、行2 两个值；
 *    早餐后增至 3 条 → 3 行，其余时段不受影响）。
 * 装箱粒度仍为子行（日期组可跨页、不留大白块），日期列由 PrintReportDocument
 * 按「页内连续同日期片段」合并 rowspan（同日期跨两页时两页各自合并自己的片段）。
 */
export interface ReportPrintUnit {
  /** 单元键 = `日期#子行序号`（组内唯一），与行上的 data-print-unit-key 一致 */
  key: string;
  date: string;
  /** 各时段列的 entry（index = data.columns 列序），该位无记录则为 null */
  cells: (GlucoseReportEntry | null)[];
  /** 本子行内字典 counted=true 的条数（页脚「本页 X 条数据」用，口径裁定 Q2 不变） */
  counted: number;
  /** 本子行内的 entry 条数（页脚「总计 Y 条数据」与审计留痕用，口径=可见记录数，2026-11-26 裁定） */
  visible: number;
}

/**
 * counted 码集合：**动态跟随字典 `counted=true`**（裁定 Q2，与统计栏「总计」同口径）。
 * 禁止硬编码排除 5~9——临床改字典（如把某类重新计入）打印页脚自动跟随。
 */
export function countedCodeSet(resultTypes: DictItemOption[]): Set<string> {
  return new Set(resultTypes.filter((option) => option.counted).map((option) => option.code));
}

/**
 * 报表响应 → 打印分页单元（对齐子行）。
 *
 * - 先走 `filterReportRows`（常规/强化勾选过滤，与屏幕同一实现）；
 * - 每个日期组内按列分桶，子行数 = 单时段最大记录数，各时段第 i 条
 *   （服务端已按 measuredAt 升序，桶内顺序即对齐序）落第 i 个子行；
 * - **无可见记录的日期整组跳过**（规格 §4 裁定 16：屏幕保留空行是为分页 total
 *   口径，打印无此约束，空行只是噪音）；
 * - 输出为**子行单元**序列（日期升序 → 组内子行序），分页装箱逐子行进行，
 *   装满判定为 DOM 实测高度自适应（2026-11-25 变更裁定，不硬编码每页行数）。
 */
export function buildReportPrintUnits(
  data: GlucoseReportResponse,
  display: GlucoseReportDisplay,
  counted: Set<string>,
): ReportPrintUnit[] {
  const slotIndexOf = new Map(data.columns.map((column, index) => [column.code, index]));
  const units: ReportPrintUnit[] = [];

  for (const row of filterReportRows(data.rows, display)) {
    // 按列分桶（防御：列集合外的格跳过，正常不发生，columns 与 cells 同源）
    const bySlot: GlucoseReportEntry[][] = data.columns.map(() => []);
    row.cells.forEach((cell) => {
      const slotIndex = slotIndexOf.get(cell.slotCode);
      if (slotIndex === undefined) {
        return;
      }
      bySlot[slotIndex].push(...cell.entries);
    });
    const depth = bySlot.reduce((max, list) => Math.max(max, list.length), 0);
    for (let index = 0; index < depth; index += 1) {
      const cells = bySlot.map((list) => list[index] ?? null);
      let countedSum = 0;
      let visible = 0;
      for (const entry of cells) {
        if (entry === null) {
          continue;
        }
        visible += 1;
        if (counted.has(entry.resultType)) {
          countedSum += 1;
        }
      }
      units.push({
        key: `${row.date}#${index}`,
        date: row.date,
        cells,
        counted: countedSum,
        visible,
      });
    }
  }
  return units;
}

/**
 * 可见记录条数（2026-11-26 需求人裁定：打印页脚「总计 Y 条数据」与审计留痕条数口径）=
 * 展示勾选过滤后实际渲染的 entry 总条数，**含**拒检/请假等 5~9（表格里看得见，
 * 只是不计入 counted 临床口径；原裁定 17 用 stats.total 导致与可见条数对不上）。
 * 供 Modal 层算审计条数；与 buildReportPrintUnits 的 Σvisible 同口径（不建子行、直接数）。
 */
export function countVisibleReportRecords(
  data: GlucoseReportResponse,
  display: GlucoseReportDisplay,
): number {
  let total = 0;
  for (const row of filterReportRows(data.rows, display)) {
    for (const cell of row.cells) {
      total += cell.entries.length;
    }
  }
  return total;
}

/** 记录列表 → 每条的 counted 计数（记录打印一行一个单元；页脚「本页 X 条」用） */
export function buildRecordPrintCounted(
  items: GlucoseRecordListItem[],
  counted: Set<string>,
): number[] {
  return items.map((item) => (counted.has(item.resultType) ? 1 : 0));
}
