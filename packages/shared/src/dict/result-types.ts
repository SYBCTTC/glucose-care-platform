/**
 * 检测结果类型（公共数据 D-RESULT）。
 * 用于血糖录入 / 质控记录等场景的结果下拉，前端用 getResultTypeLabel 取中文。
 * 来源：静态字典，随 @gc/shared 发布；取值如需调整走需求评审，不要在前端硬编码。
 */
export const RESULT_TYPE = {
  /** 正常检测 */
  NORMAL: 'NORMAL',
  /** 偏低 */
  LOW: 'LOW',
  /** 偏高 */
  HIGH: 'HIGH',
  /** 拒检 */
  REFUSED: 'REFUSED',
  /** 外出 */
  OUT: 'OUT',
} as const;
export type ResultTypeCode = (typeof RESULT_TYPE)[keyof typeof RESULT_TYPE];

export const RESULT_TYPE_LABELS: Record<ResultTypeCode, string> = {
  NORMAL: '检测',
  LOW: 'Low',
  HIGH: 'High',
  REFUSED: '拒检',
  OUT: '外出',
};

/**
 * 是否计入血糖统计：
 * - NORMAL / LOW / HIGH 计入（LOW/HIGH 标记异常但仍可见）
 * - REFUSED / OUT 不计入
 */
export const RESULT_TYPE_COUNTED: Record<ResultTypeCode, boolean> = {
  NORMAL: true,
  LOW: true,
  HIGH: true,
  REFUSED: false,
  OUT: false,
};

export function getResultTypeLabel(code: string): string {
  return RESULT_TYPE_LABELS[code as ResultTypeCode] ?? code;
}
