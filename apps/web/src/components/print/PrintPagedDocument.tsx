import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { PatientDetail } from '@gc/shared';
import PrintSheet from './PrintSheet';
import { usePrintPagination } from './usePrintPagination';
import { buildPrintFooter } from './paginate';
import { PRINT_CONTENT_WIDTH_PX } from './printConstants';

/**
 * R28 打印公共层：**需要分页**的打印文档骨架（报告/记录共用；趋势图单页不用本组件）。
 *
 * 职责（docs/specs/glucose-print.md §4 规则 9/10、§6）：
 *  1. 渲染隐藏测量层（校准 sheet + 全量内容），交给 usePrintPagination 实测分页；
 *  2. 按分页结果渲染 N 张 PrintSheet，每页重复完整头部（裁定：新页与首页一致）；
 *  3. 每页页脚 `第X/Y页，本页N条数据，总计M条数据`（裁定 Q3/Q4，文案不变）——
 *     N 按该页单元的 counted 数求和（字典 counted 口径，裁定 Q2 不变）；
 *     M = 全部单元的可见记录数求和（2026-11-26 需求人裁定；原 = 服务端
 *     stats.total 裁定 17，因拒检/请假等可见但不计入 counted、数字对不上而改）。
 *
 * 内容表格由调用方以 render prop 提供（测量层与真实页共用同一渲染函数，
 * 保证量到的高度与实际打印一致）；行上须打 data-print-unit / data-print-unit-key。
 */

export interface PrintPageUnit {
  /** 单元唯一键（报表 = `日期#子行序号`，记录 = 记录 id），与行上的 data-print-unit-key 一致 */
  key: string;
  /** 该单元内 counted=true 的记录数（页脚「本页 X 条」用，口径见裁定 Q2/Q3） */
  counted: number;
  /** 该单元内可见记录数（页脚「总计 Y 条」求和用，2026-11-26 裁定；记录打印恒 1） */
  visible: number;
}

export interface PrintPagedDocumentProps {
  subtitle: string;
  patient: PatientDetail;
  plainName: string | null;
  rangeText: string;
  units: PrintPageUnit[];
  /** 隐藏测量层里的全量内容（所有单元的行，含 data-print-unit 标记） */
  measureContent: ReactNode;
  /** 渲染一页的内容（该页单元的 key，按页内顺序） */
  renderPageContent: (pageKeys: string[]) => ReactNode;
  /** 重测依赖：数据/展示勾选变化时传入新引用（如 data、display 对象） */
  measureVersion: unknown;
  /** 实测分页产出后回调一次（pages 由 null 变非 null；重测回 null 后再产出会再回调）。
      无头打印执行器以此作为「可打印」信号；预览类场景不传 */
  onPagesReady?: () => void;
}

export default function PrintPagedDocument({
  subtitle,
  patient,
  plainName,
  rangeText,
  units,
  measureContent,
  renderPageContent,
  measureVersion,
  onPagesReady,
}: PrintPagedDocumentProps) {
  const measureRef = useRef<HTMLDivElement>(null);
  const ready = units.length > 0;
  const pages = usePrintPagination(measureRef, ready, measureVersion);

  // 分页产出（null → 非 null）回调一次；重测回 null 后复位，允许再次回调
  const pagesNotified = useRef(false);
  useEffect(() => {
    if (pages !== null && !pagesNotified.current) {
      pagesNotified.current = true;
      onPagesReady?.();
    }
    if (pages === null) {
      pagesNotified.current = false;
    }
  }, [pages, onPagesReady]);

  const countedByKey = useMemo(
    () => new Map(units.map((unit) => [unit.key, unit.counted])),
    [units],
  );
  // 页脚「总计 Y 条」= 全部单元可见记录数之和（2026-11-26 裁定，与审计留痕同口径）
  const totalCount = useMemo(() => units.reduce((sum, unit) => sum + unit.visible, 0), [units]);

  return (
    <>
      {/* 隐藏测量层：屏外渲染但保留布局（visibility hidden 仍可量高）。
          校准 sheet 带一份页脚占位，保证「每页可用高度」与真实页（含页脚）一致 */}
      <div ref={measureRef as RefObject<HTMLDivElement>} className="gc-print-measure" aria-hidden>
        <PrintSheet
          subtitle={subtitle}
          patient={patient}
          plainName={plainName}
          rangeText={rangeText}
          footer={buildPrintFooter(0, 1, 0, totalCount)}
        >
          <div style={{ height: '100%' }} />
        </PrintSheet>
        <div style={{ width: PRINT_CONTENT_WIDTH_PX }}>{measureContent}</div>
      </div>

      {pages?.map((pageKeys, pageIndex) => {
        const pageTotal = pageKeys.reduce((sum, key) => sum + (countedByKey.get(key) ?? 0), 0);
        return (
          <PrintSheet
            key={pageKeys[0] ?? pageIndex}
            subtitle={subtitle}
            patient={patient}
            plainName={plainName}
            rangeText={rangeText}
            footer={buildPrintFooter(pageIndex, pages.length, pageTotal, totalCount)}
          >
            {renderPageContent(pageKeys)}
          </PrintSheet>
        );
      })}
    </>
  );
}
