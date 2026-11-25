import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { packUnitsIntoPages } from './paginate';

/**
 * R28 打印分页 hook（裁定 D1：DOM 实测，不做公式推算）。
 *
 * `measureRef` 指向**隐藏测量层**（.gc-print-measure，屏外渲染、有布局），内含：
 *  1. 一张校准 PrintSheet（与真实页同头部/时间行/页脚），其 `[data-print-content-slot]`
 *     的实测高度 = 每页内容可用高度；
 *  2. 全部内容，每个分页单元的行打 `data-print-unit` + `data-print-unit-key`
 *     （同一 key 的多行聚合为一个单元——报表的日期组 rowspan 不可跨页拆，裁定 C1/规则 10）。
 *
 * ready 变 true 或 `version` 变化（数据/勾选变了）时重测；返回按单元 key 分组的页。
 * 测量在 useLayoutEffect 里同步完成，浏览器绘制前即产出分页，预览不会闪。
 */
export function usePrintPagination(
  measureRef: RefObject<HTMLDivElement | null>,
  ready: boolean,
  version: unknown,
): string[][] | null {
  const [pages, setPages] = useState<string[][] | null>(null);

  useLayoutEffect(() => {
    if (!ready) {
      setPages(null);
      return;
    }
    const root = measureRef.current;
    if (!root) {
      return;
    }

    const slot = root.querySelector('[data-print-content-slot]');
    const availableHeight = slot?.getBoundingClientRect().height ?? 0;
    if (availableHeight <= 0) {
      return;
    }

    // 按 key 聚合单元高度（同 key 的行在 DOM 里相邻，顺序即单元顺序）
    const keys: string[] = [];
    const heights: number[] = [];
    root.querySelectorAll<HTMLElement>('[data-print-unit]').forEach((element) => {
      const key = element.dataset.printUnitKey ?? '';
      const height = element.getBoundingClientRect().height;
      const lastIndex = keys.length - 1;
      if (lastIndex >= 0 && keys[lastIndex] === key) {
        heights[lastIndex] += height;
      } else {
        keys.push(key);
        heights.push(height);
      }
    });

    const packed = packUnitsIntoPages(heights, availableHeight);
    setPages(packed.map((page) => page.map((unitIndex) => keys[unitIndex])));
  }, [measureRef, ready, version]);

  return pages;
}
