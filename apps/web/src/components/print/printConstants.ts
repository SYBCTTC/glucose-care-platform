import type { PatientStatus } from '@gc/shared';

/**
 * R28 打印公共常量（docs/specs/glucose-print.md §4/§6）。
 *
 * 打印件恒为「白底黑字、固定字号」，不随主题/暗色模式/字号档变化（规格 §4 规则 14），
 * 因此本文件与 global.css 打印节走同一约定：**这里的色值/尺寸是打印输出常量，
 * 不是主题令牌**，不适用 ui-design-tokens 的语义色规则（屏幕上仍全部走 token）。
 */

/**
 * 打印大标题：默认「血糖管理平台」（需求 2026-11-25 第 2 条）。
 * 后续动态化（如接 SystemConfig 的医院名称）只改这一处，所有打印场景自动跟随。
 */
export const PRINT_HOSPITAL_NAME = '血糖管理平台';

/** 打印类型 → 小标题（需求第 2 条：三种打印各自的单据名，单位固定 mmol/L） */
export const PRINT_SUBTITLES: Record<'report' | 'record' | 'trend', string> = {
  report: '患者血糖报告单（mmol/L）',
  record: '患者血糖记录单（mmol/L）',
  trend: '患者血糖趋势图（mmol/L）',
};

/**
 * 打印件上的患者状态文案（需求第 2 条：住院/出院）。
 * 与屏幕的 PATIENT_STATUS_LABELS（住院患者/出院患者）不同——打印单据用短文案，
 * 属打印输出常量，故独立一份而不是改共享标签。
 */
export const PRINT_STATUS_LABELS: Record<PatientStatus, string> = {
  INPATIENT: '住院',
  DISCHARGED: '出院',
};

/** A4 纵向（裁定 C4） */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

/** 页边距 12mm（裁定 C4：10~15mm 区间内取值，四边相同） */
export const PRINT_MARGIN_MM = 12;

/**
 * mm → CSS px。浏览器屏幕与打印统一按 96dpi 换算（1mm = 96/25.4 px），
 * 因此屏幕预览量到的高度与打印输出一致，分页计算可共用同一套数值（裁定 D1）。
 */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4;
}

/** A4 页宽/高（px），预览容器与 Modal 宽度计算用 */
export const PRINT_PAGE_WIDTH_PX = mmToPx(A4_WIDTH_MM);
export const PRINT_PAGE_HEIGHT_PX = mmToPx(A4_HEIGHT_MM);

/** 内容区宽度（px）= 页宽 - 左右边距；隐藏测量层必须与真实页同宽，量高才准 */
export const PRINT_CONTENT_WIDTH_PX = mmToPx(A4_WIDTH_MM - PRINT_MARGIN_MM * 2);

/**
 * 趋势图打印图片背景色（裁定 C3：getDataURL 白底）。
 * 打印件恒白底（规格 §4 规则 14），与 global.css 打印节的 #fff 同口径，非主题色。
 */
export const PRINT_IMAGE_BACKGROUND = '#fff';
