import { z } from 'zod';

/**
 * 统一响应结构（错误码规范见 docs/ERROR-CODES.md）
 * code = 0 表示成功，非 0 为业务错误码。
 */
export const fieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const apiResponseSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().nullable(),
  /** 字段级错误（仅校验类错误返回），前端映射到表单项 */
  details: z.array(fieldErrorSchema).optional(),
  /** 排障编号，5xx 时前端展示给用户报修 */
  requestId: z.string().optional(),
  timestamp: z.string().optional(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ApiResponse<T = unknown> = {
  code: number;
  message: string;
  data: T;
  details?: FieldError[];
  requestId?: string;
  timestamp?: string;
};
