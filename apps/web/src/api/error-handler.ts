import { ERROR_CODES, errorMeta } from '@gc/shared';
import { message } from 'antd';
import type { ApiError } from './client';
import { clearToken } from './client';

/**
 * 错误码 → UI 处理策略（docs/ERROR-CODES.md E 节）。
 * 由请求拦截器统一调用，页面无需各自处理。
 */

/** 需要刷新列表的错误（409 并发/冲突类）向页面广播该事件 */
export const API_REFRESH_EVENT = 'gc:api-refresh';

/** 服务端要求强制改密（20005）：通知布局层弹出不可关闭的改密框 */
export const FORCE_PASSWORD_EVENT = 'gc:force-password';

/** 权限类拒绝（30004/30002）：通知布局层重拉一次权限再提示 */
export const REFRESH_PROFILE_EVENT = 'gc:refresh-profile';

/** 权限类错误码：先重拉权限（可能刚被管理员改动），再按 action 提示 */
const PERMISSION_DENIED_CODES: number[] = [
  ERROR_CODES.MISSING_PERMISSION,
  ERROR_CODES.CROSS_DEPARTMENT_DENIED,
];

/** 同一窗口内只重拉一次，避免并发多个 403 时反复请求 */
const PROFILE_REFRESH_WINDOW = 3000;
let lastProfileRefreshAt = 0;

/** toast 去重窗口（毫秒）：同一错误码在此窗口内只提示一次 */
const TOAST_DEDUPE_WINDOW = 2000;

const lastToastAt = new Map<number, number>();

let reloginHandled = false;

/** 清 token 并跳登录；并发请求只触发一次跳转，redirect 用于登录后回跳 */
function redirectToLogin(): void {
  clearToken();
  if (reloginHandled) {
    return;
  }
  reloginHandled = true;
  const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  window.location.href = `/login?redirect=${redirect}`;
  // 页面若未立即卸载则释放标记，避免永久吞掉跳转
  window.setTimeout(() => {
    reloginHandled = false;
  }, 3000);
}

function toastDedupe(code: number): boolean {
  const now = Date.now();
  const last = lastToastAt.get(code) ?? 0;
  if (now - last < TOAST_DEDUPE_WINDOW) {
    return true;
  }
  lastToastAt.set(code, now);
  return false;
}

function dispatchRefresh(): void {
  window.dispatchEvent(new CustomEvent(API_REFRESH_EVENT));
}

/**
 * 按错误码执行统一 UI 策略。
 * 注意：action = 'field' 时不弹全局提示，由页面把 details 映射到表单项。
 */
export function applyErrorStrategy(error: ApiError): void {
  // 强制改密：不弹 toast，改为唤起不可关闭的改密弹窗
  if (error.code === ERROR_CODES.PASSWORD_CHANGE_REQUIRED) {
    window.dispatchEvent(new CustomEvent(FORCE_PASSWORD_EVENT));
    return;
  }

  // 权限类拒绝：先重拉一次权限（可能刚被管理员改动），再走 toast
  if (PERMISSION_DENIED_CODES.includes(error.code)) {
    const now = Date.now();
    if (now - lastProfileRefreshAt > PROFILE_REFRESH_WINDOW) {
      lastProfileRefreshAt = now;
      window.dispatchEvent(new CustomEvent(REFRESH_PROFILE_EVENT));
    }
  }

  const { action } = errorMeta(error.code);

  switch (action) {
    case 'relogin':
      // 会话失效：清 token 后跳登录，不弹提示（跳走后也看不到）
      redirectToLogin();
      break;

    case 'field':
      // 字段级错误交由页面处理，此处不打扰用户
      break;

    case 'lock':
      if (toastDedupe(error.code)) break;
      void message.error(error.message, 5);
      break;

    case 'fatal': {
      if (toastDedupe(error.code)) break;
      // 系统故障：附带 requestId，便于用户报修、信息科定位日志
      const suffix = error.requestId ? `（编号 ${error.requestId.slice(0, 8)}）` : '';
      void message.error(`系统繁忙，请稍后重试${suffix}`, 5);
      // 前端埋点：内网可自建日志采集
      console.error('[api]', error.code, error.requestId, error.message);
      break;
    }

    case 'toast-refresh':
      if (toastDedupe(error.code)) break;
      void message.warning(error.message);
      dispatchRefresh();
      break;

    case 'toast':
      if (toastDedupe(error.code)) break;
      void message.warning(error.message);
      break;

    default:
      break;
  }
}
