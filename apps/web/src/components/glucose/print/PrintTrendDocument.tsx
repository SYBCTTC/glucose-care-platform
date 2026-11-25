import type { PatientDetail } from '@gc/shared';
import PrintSheet from '@/components/print/PrintSheet';
import { PRINT_SUBTITLES } from '@/components/print/printConstants';

/**
 * R28：血糖趋势图打印文档（docs/specs/glucose-print.md §4 规则 8，裁定 C3）。
 *
 * 图表以图片形式打印（Tab 在打开预览时用 ECharts getDataURL 生成，pixelRatio 2、白底），
 * **所见即所得**：当前时段过滤/折线散点形态原样上纸。占满页宽、高度按原图比例。
 * 单页不分页、无页脚（裁定 Q3）——只有一张图，不存在切分问题（需求第 4 条）。
 */
export interface PrintTrendDocumentProps {
  /** ECharts getDataURL 产物（打开预览时生成） */
  chartImage: string;
  patient: PatientDetail;
  plainName: string | null;
  rangeText: string;
}

export default function PrintTrendDocument({
  chartImage,
  patient,
  plainName,
  rangeText,
}: PrintTrendDocumentProps) {
  return (
    <PrintSheet
      subtitle={PRINT_SUBTITLES.trend}
      patient={patient}
      plainName={plainName}
      rangeText={rangeText}
    >
      <img src={chartImage} alt="血糖趋势图" style={{ display: 'block', width: '100%' }} />
    </PrintSheet>
  );
}
