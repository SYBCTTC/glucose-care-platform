import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@gc/shared';
import { BusinessException } from '../exceptions/business.exception';
import type { AuthenticatedUser } from '../types';

/**
 * 强制改密期间只允许"把密码改掉"或"退出"，其余接口一律 20005。
 *
 * 为什么必须有这道服务端拦截：
 * 前端弹窗只是体验，用户可以关掉弹窗或直接调接口绕过；安全边界必须在服务端。
 * 判定依据取 JWT 里的 `mustChangePassword` 快照，因此改密前签发的旧令牌也会被挡住。
 *
 * 已知遗留：改密成功后旧令牌不会立即失效（JWT 无权限版本），
 * 但因它仍是 `mustChangePassword = true`，访问业务接口仍会被这里拦截。
 */
const ALLOWED_PATHS = ['/auth/change-password', '/auth/logout', '/auth/profile', '/health'];

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      originalUrl?: string;
      url?: string;
    }>();

    if (!request.user?.mustChangePassword) {
      return true;
    }

    const raw = String(request.originalUrl ?? request.url ?? '');
    const path = raw.split('?')[0];
    const allowed = ALLOWED_PATHS.some(
      (allowedPath) => path === allowedPath || path === `/api${allowedPath}` || path.endsWith(allowedPath),
    );
    if (allowed) {
      return true;
    }

    throw new BusinessException(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
  }
}
