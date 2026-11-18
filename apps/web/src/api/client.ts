import { ERROR_CODES } from '@gc/shared';
import type { ApiResponse, FieldError } from '@gc/shared';
import { applyErrorStrategy } from './error-handler';

/**
 * 统一请求客户端。
 * 约定：
 *  1. 所有接口走 /api 前缀（开发由 Vite 代理，生产由 Nginx 反代）
 *  2. 后端统一响应 { code, message, data }；code = 0 成功，非 0 为业务错误码
 *     （错误码规范见 docs/ERROR-CODES.md）
 *  3. 错误统一由 applyErrorStrategy 按错误码分派：
 *     - 20001/20006/20007 字段级提示，不跳登录
 *     - 20002/20008 清 token 并跳登录（并发请求只跳一次）
 *     - 5xxxx 统一兜底文案 + requestId 便于报修
 *  4. 字段级错误的 details 由页面映射到表单项
 */

export const TOKEN_STORAGE_KEY = 'gc_access_token';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly details?: FieldError[],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 是否字段级错误（校验类，页面应映射到表单项） */
  get isFieldError(): boolean {
    return Boolean(this.details?.length);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  // 注意：等保要求更严格的场景应改用 httpOnly + Secure Cookie 承载令牌，
  // 此处保留 localStorage 仅为简化内网部署，后续可替换实现而不改调用方。
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();

  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    // 网络不可达 / 请求被取消：与业务错误码区分处理
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, ERROR_CODES.SUCCESS, '请求已取消');
    }
    throw new ApiError(0, ERROR_CODES.INTERNAL_ERROR, '无法连接服务器，请检查网络或内网环境');
  }

  const payload = (await response.json()) as ApiResponse<T>;
  const code = payload.code;
  const message = payload.message;

  if (code === ERROR_CODES.SUCCESS) {
    return payload.data;
  }

  const apiError = new ApiError(response.status, code, message, payload.details, payload.requestId);
  applyErrorStrategy(apiError);
  throw apiError;
}

export const http = {
  get: <T>(url: string, params?: Record<string, unknown>) => {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
              acc[key] = String(value);
            }
            return acc;
          }, {}),
        )}`
      : '';
    return request<T>('GET', `${url}${query}`);
  },
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  /** 无请求体；用于"移出虚拟病区"这类以路径参数表达意图的删除语义 */
  delete: <T>(url: string) => request<T>('DELETE', url),
};
