import type { ReactNode } from 'react';
import type { PatientDetail } from '@gc/shared';
import PrintPatientInfo from './PrintPatientInfo';
import { PRINT_HOSPITAL_NAME } from './printConstants';

/**
 * R28 打印公共层：一张 A4 页（docs/specs/glucose-print.md §4 规则 1/§6）。
 *
 * 每页重复完整头部：大标题 → 小标题 → 患者信息 → 时间范围行（紧贴内容区右上），
 * 内容区 flex:1，页脚（可选）紧贴内容区左下。版式尺寸/颜色见 global.css 打印节
 * （A4 纵向、边距 12mm、恒白底黑字，裁定 C4/规格规则 14）。
 *
 * 后续全院血糖、质控记录等打印直接复用本组件（裁定 D2）：
 * 只需换 subtitle 与 children，头部/患者信息/分页口径全部一致。
 */
export interface PrintSheetProps {
  /** 小标题（PRINT_SUBTITLES 之一，或后续其他单据名） */
  subtitle: string;
  patient: PatientDetail;
  /** 明文姓名；null 回退 nameMasked（规格 §4 规则 15） */
  plainName: string | null;
  /** 时间范围行文案（formatPrintRangeFromDates 产物：依据打印文档数据派生） */
  rangeText: string;
  /** 页脚文案；undefined = 不展示（裁定 Q3：趋势图无页脚） */
  footer?: string;
  children?: ReactNode;
}

export default function PrintSheet({
  subtitle,
  patient,
  plainName,
  rangeText,
  footer,
  children,
}: PrintSheetProps) {
  return (
    <div className="gc-print-sheet">
      <div className="gc-print-main-title">{PRINT_HOSPITAL_NAME}</div>
      <div className="gc-print-sub-title">{subtitle}</div>
      <PrintPatientInfo patient={patient} plainName={plainName} />
      <div className="gc-print-range">{rangeText}</div>
      {/* data-print-content-slot：分页校准锚点——usePrintPagination 量这个节点的高度
          作为「每页可用高度」（sheet 固定高、flex 布局下它 = 页高 - 头部 - 时间行 - 页脚） */}
      <div className="gc-print-content" data-print-content-slot="">
        {children}
      </div>
      {footer !== undefined ? <div className="gc-print-page-footer">{footer}</div> : null}
    </div>
  );
}
