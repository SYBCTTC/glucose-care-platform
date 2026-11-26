import dayjs from 'dayjs';

/**
 * R28 打印分页与文案的**纯函数**层（docs/specs/glucose-print.md §4）。
 * 全部可单测（paginate.spec.ts）；DOM 测量在 usePrintPagination，这里只做计算。
 */

/**
 * 贪心装箱：把分页单元的实测高度按「每页可用高度」切分成页（裁定 D1 的计算部分）。
 *
 * - 单元顺序不变，装满即换页；
 * - 单元自身高于整页时**独占一页**（防御分支：正常数据不触发，触发时内容被
 *   sheet 的 overflow hidden 截断，好过死循环）；
 * - 空输入 → 空页列表（调用方对「无数据」另有禁用门控，裁定 B3）。
 *
 * 返回每页包含的单元下标（入参数组的 index），由调用方映射回业务单元。
 */
export function packUnitsIntoPages(heights: number[], availableHeight: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;

  heights.forEach((height, index) => {
    // 当前页已有内容且放不下 → 先换页再放入（current 为空时不换页 = 超高单元独占一页）
    if (current.length > 0 && used + height > availableHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(index);
    used += height;
  });

  if (current.length > 0) {
    pages.push(current);
  }
  return pages;
}

/**
 * 时间范围行的日期格式（裁定 B2）：`YYYY-MM-DD[ HH:mm:ss]` → `YYYY年MM月DD日`，
 * **丢弃时分秒**；空/非法 → '-'。
 */
export function formatPrintDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY年MM月DD日') : '-';
}

/** 患者信息里的日期（住院/出院日期）：截到日，空/非法 → '-' */
export function formatPrintDay(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '-';
}

/**
 * 时间范围行文案（2026-11-25 变更裁定）：`时间：<起>~<止>`，**依据打印文档的数据**——
 * 取全量获取数据的最早/最晚测量日期（报告行日期 / 记录与趋势的 measuredAt），
 * 不依据查询筛选条件（原取 appliedRange，筛选为空时展示「-~-」无信息量）。
 * 起止同日只展示单个日期；空数据 → `时间：-`（防御，空数据时打印按钮本就禁用）。
 */
export function formatPrintRangeFromDates(dates: readonly string[]): string {
  const valid = dates.filter((date) => date.length > 0);
  if (valid.length === 0) {
    return '时间：-';
  }
  let min = valid[0];
  let max = valid[0];
  for (const date of valid) {
    if (date < min) {
      min = date;
    }
    if (date > max) {
      max = date;
    }
  }
  const minDay = min.slice(0, 10);
  const maxDay = max.slice(0, 10);
  if (minDay === maxDay) {
    return `时间：${formatPrintDate(minDay)}`;
  }
  return `时间：${formatPrintDate(minDay)}~${formatPrintDate(maxDay)}`;
}

/**
 * 页脚文案（裁定 Q3/Q4，每页展示）：`第<当前页>/<总页>页，本页<X>条数据，总计<Y>条数据`。
 * pageIndex 从 0 起；X = 该页 counted 记录数（字典 counted 口径，裁定 Q2 不变）；
 * Y = 范围内**可见记录数**（2026-11-26 需求人裁定，替代裁定 17 的 stats.total 口径）。
 */
export function buildPrintFooter(
  pageIndex: number,
  pageCount: number,
  pageTotal: number,
  totalCount: number,
): string {
  return `第${pageIndex + 1}/${pageCount}页，本页${pageTotal}条数据，总计${totalCount}条数据`;
}
