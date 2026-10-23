import type { ApiResponse } from '@gc/shared';

/** 统一成功响应（HTTP 200，code = 0） */
export function ok<T>(data: T): ApiResponse<T> {
  return { code: 0, message: 'success', data };
}

/** 统一分页响应 */
export function page<T>(items: T[], total: number, pageNo: number, pageSize: number): ApiResponse<{
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}> {
  return ok({ items, total, page: pageNo, pageSize });
}